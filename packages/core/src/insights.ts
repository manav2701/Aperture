import { toolById } from './ai-tools';
import { parseUsd } from './money';

/*
 * Seat insights (plan/phases/phase-12 §12.7): where an org spends on AI seats it doesn't use,
 * pays twice, or would pay less another way. Every insight carries an estimated monthly saving
 * in µUSD that is never negative; insights that save nothing but matter (admin control, approved
 * tools) carry zero and say why. Estimates use list prices unless the seat has a known cost.
 */

export interface InsightSeat {
  id: string;
  toolId: string;
  plan: string | null;
  userId: string | null;
  payer: 'company' | 'personal_expensed' | 'personal_unexpensed' | 'unknown';
  status: 'active' | 'idle' | 'cancelled';
  source: 'connector' | 'receipt' | 'statement' | 'declared' | 'import' | 'manual';
  /** Known monthly cost (µUSD decimal string), else the plan's list price is used. */
  monthlyCost: string | null;
  lastActiveAt: string | null;
}

export interface InsightUsage {
  userId: string;
  toolId: string;
  /** List-price-equivalent usage over the last 30 days, µUSD. */
  last30Days: bigint;
}

export type InsightKind = 'idle_seat' | 'duplicate' | 'consolidate' | 'seat_vs_api' | 'unapproved_tool';

export interface Insight {
  kind: InsightKind;
  toolId: string;
  seatIds: string[];
  userIds: string[];
  /** Estimated monthly saving in µUSD; never negative. */
  monthlySaving: bigint;
  detail: string;
}

const DAY_MS = 86_400_000;

/** The seat's monthly cost in µUSD: its known cost, else the plan's list price, else zero. */
export function seatMonthlyCost(seat: Pick<InsightSeat, 'toolId' | 'plan' | 'monthlyCost'>): bigint {
  if (seat.monthlyCost !== null) return BigInt(seat.monthlyCost);
  const listPrice = toolById(seat.toolId)?.plans.find((p) => p.id === seat.plan)?.monthlyUsd;
  return listPrice === null || listPrice === undefined ? 0n : parseUsd(listPrice);
}

const usdText = (amount: bigint) => {
  const cents = (amount + 5_000n) / 10_000n;
  return `$${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, '0')}`;
};

export function seatInsights(input: {
  seats: readonly InsightSeat[];
  usage: readonly InsightUsage[];
  approvedTools: readonly string[];
  idleDays: number;
  now: Date;
}): Insight[] {
  const live = input.seats.filter((s) => s.status !== 'cancelled');
  const insights: Insight[] = [];
  const name = (toolId: string) => toolById(toolId)?.product ?? toolId;

  // Idle seats: only where a connector or import reports activity, so "no data" isn't "idle".
  for (const seat of live) {
    const measured = seat.source === 'connector' || seat.source === 'import';
    const idle =
      seat.status === 'idle' ||
      (measured &&
        (seat.lastActiveAt === null || input.now.getTime() - Date.parse(seat.lastActiveAt) > input.idleDays * DAY_MS));
    if (!idle) continue;
    insights.push({
      kind: 'idle_seat',
      toolId: seat.toolId,
      seatIds: [seat.id],
      userIds: seat.userId === null ? [] : [seat.userId],
      monthlySaving: seatMonthlyCost(seat),
      detail: `${name(seat.toolId)} seat unused for over ${String(input.idleDays)} days`,
    });
  }

  // Duplicates: a personal plan next to a company seat for the same tool.
  const company = new Map<string, InsightSeat>();
  for (const seat of live)
    if (seat.payer === 'company' && seat.userId !== null) company.set(`${seat.userId}|${seat.toolId}`, seat);
  for (const seat of live) {
    if (!seat.payer.startsWith('personal') || seat.userId === null) continue;
    const covered = company.get(`${seat.userId}|${seat.toolId}`);
    if (covered === undefined) continue;
    insights.push({
      kind: 'duplicate',
      toolId: seat.toolId,
      seatIds: [seat.id, covered.id],
      userIds: [seat.userId],
      // Only an expensed plan costs the company; an unexpensed one costs the person.
      monthlySaving: seat.payer === 'personal_expensed' ? seatMonthlyCost(seat) : 0n,
      detail: `pays for ${name(seat.toolId)} personally next to a company seat`,
    });
  }

  // Consolidation: several people expensing personal plans of one vendor that sells a team plan.
  const expensed = new Map<string, InsightSeat[]>();
  for (const seat of live) {
    if (seat.payer !== 'personal_expensed') continue;
    expensed.set(seat.toolId, [...(expensed.get(seat.toolId) ?? []), seat]);
  }
  for (const [toolId, seats] of expensed) {
    const teamPlan = toolById(toolId)?.plans.find((p) => p.team && p.monthlyUsd !== null);
    if (seats.length < 3 || teamPlan?.monthlyUsd == null) continue;
    const today = seats.reduce((sum, s) => sum + seatMonthlyCost(s), 0n);
    const consolidated = parseUsd(teamPlan.monthlyUsd) * BigInt(seats.length);
    const difference = today - consolidated;
    insights.push({
      kind: 'consolidate',
      toolId,
      seatIds: seats.map((s) => s.id),
      userIds: seats.flatMap((s) => (s.userId === null ? [] : [s.userId])),
      monthlySaving: difference > 0n ? difference : 0n,
      detail:
        difference >= 0n
          ? `${String(seats.length)} people expense ${name(toolId)}; ${teamPlan.name} would cost ${usdText(consolidated)} a month instead of ${usdText(today)}, with admin controls`
          : `${String(seats.length)} people expense ${name(toolId)}; ${teamPlan.name} costs ${usdText(-difference)} more a month but adds admin controls and keeps work data in the company account`,
    });
  }

  // Seat versus API billing, from terminal-tool telemetry (list-price-equivalent usage).
  for (const use of input.usage) {
    const seat = live.find((s) => s.userId === use.userId && s.toolId === use.toolId && s.payer === 'company');
    if (seat === undefined) continue;
    const price = seatMonthlyCost(seat);
    if (price === 0n) continue;
    if (use.last30Days * 2n < price) {
      insights.push({
        kind: 'seat_vs_api',
        toolId: use.toolId,
        seatIds: [seat.id],
        userIds: [use.userId],
        monthlySaving: price - use.last30Days,
        detail: `${name(use.toolId)} usage is worth ${usdText(use.last30Days)} at API prices against a ${usdText(price)} seat: governed API billing would cost less`,
      });
    }
  }

  // Tools in use that aren't on the approved list (only once a list exists).
  if (input.approvedTools.length > 0) {
    const approved = new Set(input.approvedTools);
    const byTool = new Map<string, InsightSeat[]>();
    for (const seat of live)
      if (!approved.has(seat.toolId)) byTool.set(seat.toolId, [...(byTool.get(seat.toolId) ?? []), seat]);
    for (const [toolId, seats] of byTool) {
      insights.push({
        kind: 'unapproved_tool',
        toolId,
        seatIds: seats.map((s) => s.id),
        userIds: [...new Set(seats.flatMap((s) => (s.userId === null ? [] : [s.userId])))],
        monthlySaving: 0n,
        detail: `${name(toolId)} is in use but not on the approved list`,
      });
    }
  }

  return insights.sort((a, b) => (b.monthlySaving > a.monthlySaving ? 1 : b.monthlySaving < a.monthlySaving ? -1 : 0));
}
