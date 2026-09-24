/**
 * Runs a budget/policy scenario against a throwaway database and prints every decision.
 *
 *   docker compose -f infra/compose.dev.yml up -d
 *   pnpm try:simulate tools/cli/scenarios/two-teams.yaml [--audit-out audit.jsonl] [--keep]
 *
 * DATABASE_URL defaults to the dev compose Postgres. A fresh database is created for each
 * run and dropped afterwards (unless --keep), so runs never interfere with each other.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  evaluatePolicy,
  formatUsd,
  micros,
  parseUsd,
  periodKey,
  type ActionInput,
  type PolicyLayer,
} from '@aperture/core';
import {
  appendAuditEvent,
  connect,
  createBudget,
  createOrg,
  createPrincipal,
  exportAuditEvents,
  release,
  reserve,
  runMigrations,
  schema,
  setBudgetLimit,
  settle,
  verifyCounters,
  type Database,
} from '@aperture/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { parse as parseYaml } from 'yaml';
import { parseLimit, scenarioSchema, type Scenario } from './scenario';

const out = (line = '') => process.stdout.write(`${line}\n`);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'audit-out': { type: 'string' }, keep: { type: 'boolean', default: false } },
});
const scenarioArg = positionals[0];
if (scenarioArg === undefined) {
  process.stderr.write('usage: simulate <scenario.yaml> [--audit-out file.jsonl] [--keep]\n');
  process.exit(2);
}
const baseDir = process.env.INIT_CWD ?? process.cwd();
const scenarioPath = resolve(baseDir, scenarioArg);
const parsed = scenarioSchema.safeParse(parseYaml(readFileSync(scenarioPath, 'utf8')));
if (!parsed.success) {
  process.stderr.write(`Invalid scenario ${scenarioPath}:\n`);
  for (const issue of parsed.error.issues) process.stderr.write(`  - ${issue.path.join('.')}: ${issue.message}\n`);
  process.exit(2);
}
const scenario: Scenario = parsed.data;

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://aperture:aperture@127.0.0.1:5432/aperture';
const simDatabase = `sim_${randomBytes(4).toString('hex')}`;
const adminUrl = new URL(databaseUrl);
const simUrl = new URL(databaseUrl);
simUrl.pathname = `/${simDatabase}`;

async function withAdmin(statement: string) {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}

async function run() {
  await withAdmin(`create database ${simDatabase}`);
  const handle = connect(simUrl.toString(), { max: 50, systemAccess: true });
  try {
    await runMigrations(handle.db);
    await simulate(handle.db);
  } finally {
    await handle.close();
    if (!values.keep) await withAdmin(`drop database ${simDatabase}`);
  }
}

async function simulate(db: Database) {
  const org = await createOrg(db, { name: scenario.org.name, timezone: scenario.org.timezone });
  const principalIds = new Map<string, string>();
  for (const principal of scenario.principals) {
    principalIds.set(
      principal.id,
      (await createPrincipal(db, { orgId: org.id, kind: principal.kind, name: principal.name })).id,
    );
  }
  const budgetIds = new Map<string, string>();
  for (const budget of scenario.budgets) {
    const created = await createBudget(db, {
      orgId: org.id,
      name: budget.name,
      parentId: budget.parent === undefined ? undefined : budgetIds.get(budget.parent),
      scope: budget.scope,
      scopeId:
        budget.scope === 'org'
          ? org.id
          : budget.principal === undefined
            ? undefined
            : principalIds.get(budget.principal),
      unit: budget.unit,
      period: budget.period,
      limit: parseLimit(budget, budget.limit),
      mode: budget.mode,
      rails: budget.rails,
    });
    budgetIds.set(budget.id, created.id);
  }

  const layersFor = (principal: string): PolicyLayer[] => {
    const layers: PolicyLayer[] = [];
    if (scenario.policies.org)
      layers.push({ level: 'org', scopeId: org.id, version: 1, document: scenario.policies.org });
    const own = scenario.policies.principals[principal];
    if (own) layers.push({ level: 'principal', scopeId: principal, version: 1, document: own });
    return layers;
  };

  out(`Scenario: ${scenario.org.name} (timezone ${scenario.org.timezone})`);
  let requestCounter = 0;

  for (const [index, step] of scenario.steps.entries()) {
    out();
    out(`Step ${String(index + 1)}: ${step.title}`);

    if ('setLimit' in step) {
      const budget = scenario.budgets.find((b) => b.id === step.setLimit.budget);
      const budgetId = budgetIds.get(step.setLimit.budget) ?? '';
      if (!budget) throw new Error('unknown budget');
      await setBudgetLimit(db, { orgId: org.id, budgetId, limit: parseLimit(budget, step.setLimit.limit) });
      await appendAuditEvent(db, org.id, {
        actor: 'user:simulator',
        action: 'budget.limit.changed',
        subject: `budget:${budgetId}`,
        data: { budget: budget.name, limit: step.setLimit.limit },
      });
      out(`  ${budget.name} limit set to ${step.setLimit.limit}`);
      continue;
    }

    if ('pause' in step) {
      const principalId = principalIds.get(step.pause.principal) ?? '';
      await db.update(schema.principals).set({ status: 'paused' }).where(eq(schema.principals.id, principalId));
      await appendAuditEvent(db, org.id, {
        actor: 'user:simulator',
        action: 'principal.paused',
        subject: `principal:${principalId}`,
        data: {},
      });
      out(`  ${step.pause.principal} paused (kill switch)`);
      continue;
    }

    const spend = step.spend;
    const principalId = principalIds.get(spend.principal) ?? '';
    const amount = parseUsd(spend.amount);
    const tally = new Map<string, number>();
    const count = (label: string) => tally.set(label, (tally.get(label) ?? 0) + 1);

    const attempt = async () => {
      requestCounter += 1;
      const action: ActionInput = {
        rail: spend.rail,
        amount,
        ...(spend.provider === undefined ? {} : { provider: spend.provider }),
        ...(spend.model === undefined ? {} : { model: spend.model }),
      };
      const decision = evaluatePolicy({
        action,
        at: new Date(),
        timeZone: scenario.org.timezone,
        layers: layersFor(spend.principal),
      });
      if (decision.outcome !== 'allow') {
        const reasons = decision.reasons.map((reason) => reason.code).join(', ');
        count(decision.outcome === 'deny' ? `denied by policy (${reasons})` : `needs approval (${reasons})`);
        await appendAuditEvent(db, org.id, {
          actor: `agent:${principalId}`,
          action: `spend.${decision.outcome}`,
          subject: `principal:${principalId}`,
          data: { amount: spend.amount, reasons },
        });
        return;
      }
      const result = await reserve(db, {
        orgId: org.id,
        principalId,
        rail: spend.rail,
        amount,
        idempotencyKey: `sim-${String(requestCounter)}`,
        ttlSeconds: 600,
        onExpiry: 'release',
      });
      if (!result.ok) {
        const label =
          result.reason === 'budget_exceeded'
            ? `denied: budget "${result.budgetName}" exceeded (remaining ${formatUsd(micros(result.remaining))})`
            : `denied: ${result.reason}`;
        count(label);
        await appendAuditEvent(db, org.id, {
          actor: `agent:${principalId}`,
          action: 'spend.denied',
          subject: `principal:${principalId}`,
          data: {
            amount: spend.amount,
            reason: result.reason,
            ...(result.reason === 'budget_exceeded' ? { budget: result.budgetName } : {}),
          },
        });
        return;
      }
      count('allowed');
      if (spend.settle === 'full') await settle(db, { orgId: org.id, holdId: result.hold.id, actualAmount: amount });
      await appendAuditEvent(db, org.id, {
        actor: `agent:${principalId}`,
        action: 'spend.allowed',
        subject: `principal:${principalId}`,
        data: { amount: spend.amount, hold: result.hold.id },
      });
    };

    if (spend.concurrent) await Promise.all(Array.from({ length: spend.count }, attempt));
    else for (let i = 0; i < spend.count; i += 1) await attempt();

    out(
      `  ${String(spend.count)} × ${spend.amount} USD from ${spend.principal}${spend.concurrent ? ' (concurrent)' : ''}:`,
    );
    for (const [label, n] of [...tally].sort()) out(`    ${String(n).padStart(4)}  ${label}`);
  }

  out();
  out('Budgets now (current period):');
  const now = new Date();
  for (const budget of scenario.budgets) {
    const budgetId = budgetIds.get(budget.id) ?? '';
    const [row] = await db.select().from(schema.budgets).where(eq(schema.budgets.id, budgetId));
    const key = periodKey(now, budget.period, scenario.org.timezone);
    const usage = await db
      .select()
      .from(schema.budgetUsage)
      .where(eq(schema.budgetUsage.budgetId, budgetId))
      .then((rows) => rows.find((r) => r.periodKey === key));
    const limit = row?.limitAmount ?? 0n;
    const held = usage?.held ?? 0n;
    const spent = usage?.spent ?? 0n;
    const fmt = (value: bigint) => (budget.unit === 'count' ? value.toString() : formatUsd(micros(value)));
    out(
      `  ${budget.name.padEnd(28)} ${budget.period.padEnd(6)} limit ${fmt(limit).padStart(10)}  held ${fmt(held).padStart(8)}  spent ${fmt(spent).padStart(10)}  remaining ${fmt(limit - held - spent > 0n ? limit - held - spent : 0n).padStart(10)}`,
    );
  }

  const counters = await verifyCounters(db, org.id);
  out();
  out(
    `Ledger check (counters match the journal): ${counters.ok ? 'OK' : `DRIFT in ${String(counters.drift.length)} rows`}`,
  );

  const auditOut = values['audit-out'];
  if (auditOut !== undefined) {
    const records = await exportAuditEvents(db, org.id);
    const target = resolve(baseDir, auditOut);
    writeFileSync(target, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    out(`Audit log: ${String(records.length)} events written to ${target}`);
  }

  // Leave nothing open between runs.
  const open = await db.select().from(schema.holds).where(eq(schema.holds.status, 'open'));
  for (const hold of open) await release(db, { orgId: org.id, holdId: hold.id });
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
