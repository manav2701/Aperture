/**
 * Governance coverage (plan/phases/phase-11 §11.3): the share of an org's AI spend in each
 * status. `enforced` went through the gateway, a managed card, or an x402 allowance under a hard
 * budget; `visible` is imported provider usage and seats seen through admin APIs; `unassigned` is
 * provider usage on keys nobody claimed; `external` is AI spend found on statements, receipts, or
 * declarations. External evidence never touches the ledger (INV-16, INV-17); it only appears here.
 */
export const COVERAGE_STATUSES = ['enforced', 'visible', 'unassigned', 'external'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface CoverageShare {
  status: CoverageStatus;
  /** µUSD. */
  amount: bigint;
  /** Hundredths of a percent; the four shares sum to exactly 10,000 when there is any spend. */
  basisPoints: number;
}

/**
 * Splits spend into shares that always add up to 100.00% (largest-remainder rounding), so the
 * coverage bar and the attestation never show 99.99% or 100.01%. Negative amounts (net refunds)
 * count as zero.
 */
export function coverageShares(amounts: Record<CoverageStatus, bigint>): CoverageShare[] {
  const values = COVERAGE_STATUSES.map((status) => ({ status, amount: amounts[status] > 0n ? amounts[status] : 0n }));
  const total = values.reduce((sum, v) => sum + v.amount, 0n);
  if (total === 0n) return values.map((v) => ({ ...v, basisPoints: 0 }));
  const exact = values.map((v) => {
    const scaled = v.amount * 10_000n;
    return { ...v, floor: scaled / total, remainder: scaled % total };
  });
  let left = 10_000n - exact.reduce((sum, v) => sum + v.floor, 0n);
  const order = [...exact.keys()].sort((a, b) => {
    const ra = exact[a]?.remainder ?? 0n;
    const rb = exact[b]?.remainder ?? 0n;
    return ra === rb ? a - b : rb > ra ? 1 : -1;
  });
  const bonus = new Set<number>();
  for (const index of order) {
    if (left <= 0n) break;
    bonus.add(index);
    left -= 1n;
  }
  return exact.map((v, index) => ({
    status: v.status,
    amount: v.amount,
    basisPoints: Number(v.floor) + (bonus.has(index) ? 1 : 0),
  }));
}

/** "82.15%" from basis points. */
export function formatShare(basisPoints: number): string {
  return `${String(Math.floor(basisPoints / 100))}.${String(basisPoints % 100).padStart(2, '0')}%`;
}
