#!/usr/bin/env node
/**
 * Sends a terminal AI tool's usage metrics to Aperture (plan/phases/phase-12 §12.6).
 *
 *   npx @aperture/connect claude-code --token apt_… --gateway https://gateway.example.com
 *   npx @aperture/connect claude-code --undo
 *
 * Shows the change and asks before writing; `--yes` skips the question. Keeps a backup of the
 * settings file next to it. `--settings <path>` writes somewhere other than ~/.claude/settings.json.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { ConnectError, TARGETS, claudeCodeEnv, connect, describe, disconnect, parseSettings } from './index';

const usage = `usage: aperture-connect claude-code --token <apt_…> --gateway <https://…> [--yes]
       aperture-connect claude-code --undo [--yes]
options: --settings <path>  settings file (default ~/.claude/settings.json)`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      token: { type: 'string', default: process.env.APERTURE_TELEMETRY_TOKEN },
      gateway: { type: 'string', default: process.env.APERTURE_GATEWAY_URL },
      settings: { type: 'string' },
      undo: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });
  const target = positionals[0];
  if (target === undefined || !(TARGETS as readonly string[]).includes(target)) {
    process.stderr.write(
      `${usage}\nsupported tools: ${TARGETS.join(', ')} (Codex and Gemini CLI are not supported yet)\n`,
    );
    return 2;
  }
  const path = values.settings ?? join(homedir(), '.claude', 'settings.json');
  const settings = parseSettings(existsSync(path) ? readFileSync(path, 'utf8') : undefined);

  let plan;
  if (values.undo) plan = disconnect(settings);
  else {
    if (values.token === undefined || values.gateway === undefined) {
      process.stderr.write(`${usage}\n`);
      return 2;
    }
    plan = connect(settings, claudeCodeEnv({ token: values.token, gatewayUrl: values.gateway }));
  }

  process.stdout.write(`${path}\n${describe(plan.changes)}\n`);
  if (plan.changes.length === 0) return 0;
  if (!values.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Write these changes? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      process.stdout.write('Nothing was changed.\n');
      return 1;
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    // The backup can hold an earlier token, so only the user may read it.
    copyFileSync(path, `${path}.aperture-backup`);
    chmodSync(`${path}.aperture-backup`, 0o600);
  }
  // Write a sibling file, then rename over the original, so a crash never leaves half a file.
  const temporary = `${path}.aperture-tmp`;
  writeFileSync(temporary, `${JSON.stringify(plan.settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  process.stdout.write(
    values.undo
      ? 'Removed. Restart Claude Code to stop sending metrics.\n'
      : 'Done. Restart Claude Code; usage appears in Aperture within a few minutes. Undo with --undo.\n',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof ConnectError ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
