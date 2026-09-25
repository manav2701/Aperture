/** How strongly Aperture can enforce budgets on a provider connection (plan/architecture §13). */
export const TIER_LABELS: Record<'T1' | 'T2' | 'T3', { title: string; detail: string }> = {
  T1: {
    title: 'Provider-enforced limits',
    detail: 'Each key carries a hard limit at the provider equal to its remaining budget.',
  },
  T2: {
    title: 'Revoke on breach',
    detail: 'Usage is imported every minute; keys are revoked when a hard budget runs out.',
  },
  T3: {
    title: 'Gateway only',
    detail: 'No usage API: govern this provider by sending its traffic through the Aperture gateway.',
  },
};
