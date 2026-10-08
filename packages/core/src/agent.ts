/** What an agent's owner declares on its card (plan/phases/phase-11 §11.7). Self-declared, never inferred. */
export const DATA_CLASSES = ['none', 'internal', 'customer_personal', 'financial', 'health'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
