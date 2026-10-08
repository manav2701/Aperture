import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seatInsights, seatMonthlyCost, type InsightSeat } from './insights';

const NOW = new Date('2026-10-08T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const seat = (over: Partial<InsightSeat>): InsightSeat => ({
  id: 's',
  toolId: 'cursor',
  plan: 'teams',
  userId: 'u1',
  payer: 'company',
  status: 'active',
  source: 'connector',
  monthlyCost: null,
  lastActiveAt: daysAgo(1),
  ...over,
});

const run = (seats: InsightSeat[], extra: Partial<Parameters<typeof seatInsights>[0]> = {}) =>
  seatInsights({ seats, usage: [], approvedTools: [], idleDays: 30, now: NOW, ...extra });

describe('seatInsights', () => {
  it('flags idle connector seats with their list price as the saving', () => {
    const [insight] = run([seat({ id: 'idle', lastActiveAt: daysAgo(45) })]);
    expect(insight).toMatchObject({ kind: 'idle_seat', seatIds: ['idle'], monthlySaving: 40_000_000n });
  });

  it('does not call a declared seat idle just because nothing reports activity', () => {
    expect(run([seat({ source: 'declared', lastActiveAt: null })])).toEqual([]);
  });

  it('finds a personal plan next to a company seat', () => {
    const insights = run([
      seat({ id: 'company', toolId: 'chatgpt', plan: 'business' }),
      seat({ id: 'personal', toolId: 'chatgpt', plan: 'plus', payer: 'personal_expensed', source: 'receipt' }),
    ]);
    expect(insights.find((i) => i.kind === 'duplicate')).toMatchObject({ monthlySaving: 20_000_000n });
  });

  it('recommends a team plan when three or more people expense one vendor, even when it costs more', () => {
    const personal = ['a', 'b', 'c'].map((id) =>
      seat({ id, userId: id, toolId: 'chatgpt', plan: 'plus', payer: 'personal_expensed', source: 'receipt' }),
    );
    const consolidate = run(personal).find((i) => i.kind === 'consolidate');
    expect(consolidate?.monthlySaving).toBe(0n);
    expect(consolidate?.detail).toContain('more a month but adds admin controls');
  });

  it('suggests API billing when telemetry shows much less usage than the seat costs', () => {
    const insights = run([seat({ id: 'cc', toolId: 'claude', plan: 'team_premium' })], {
      usage: [{ userId: 'u1', toolId: 'claude', last30Days: 12_000_000n }],
    });
    expect(insights.find((i) => i.kind === 'seat_vs_api')?.monthlySaving).toBe(138_000_000n);
  });

  it('lists unapproved tools once an approved list exists', () => {
    expect(run([seat({ toolId: 'midjourney', plan: 'pro' })], { approvedTools: ['cursor'] })[0]?.kind).toBe(
      'unapproved_tool',
    );
    expect(run([seat({ toolId: 'midjourney', plan: 'pro' })])).toEqual([]);
  });

  it('prefers a known cost over the list price', () => {
    expect(seatMonthlyCost({ toolId: 'cursor', plan: 'teams', monthlyCost: '35000000' })).toBe(35_000_000n);
    expect(seatMonthlyCost({ toolId: 'chatgpt', plan: 'enterprise', monthlyCost: null })).toBe(0n);
  });

  it('never reports a negative saving and sorts by saving (property)', () => {
    const arbitrarySeat = fc.record({
      id: fc.uuid(),
      toolId: fc.constantFrom('cursor', 'chatgpt', 'claude', 'midjourney', 'unknown-tool'),
      plan: fc.constantFrom('pro', 'plus', 'teams', 'business', null),
      userId: fc.constantFrom('u1', 'u2', 'u3', null),
      payer: fc.constantFrom('company', 'personal_expensed', 'personal_unexpensed', 'unknown'),
      status: fc.constantFrom('active', 'idle', 'cancelled'),
      source: fc.constantFrom('connector', 'receipt', 'statement', 'declared', 'import', 'manual'),
      monthlyCost: fc.option(fc.bigInt({ min: 0n, max: 10n ** 9n }).map(String), { nil: null }),
      lastActiveAt: fc.option(fc.integer({ min: 0, max: 400 }).map(daysAgo), { nil: null }),
    }) as fc.Arbitrary<InsightSeat>;
    fc.assert(
      fc.property(fc.array(arbitrarySeat, { maxLength: 30 }), (seats) => {
        const insights = run(seats, { approvedTools: ['cursor'] });
        for (const insight of insights) expect(insight.monthlySaving >= 0n).toBe(true);
        for (let i = 1; i < insights.length; i += 1)
          expect((insights[i - 1]?.monthlySaving ?? 0n) >= (insights[i]?.monthlySaving ?? 0n)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
