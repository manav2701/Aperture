/**
 * Where money moves. `gateway`: requests through Aperture's AI gateway (text and media).
 * `provider`: usage observed on provider keys outside the gateway. `card`: card authorizations.
 * `x402`: stablecoin payments signed by Aperture.
 */
export const RAILS = ['gateway', 'provider', 'card', 'x402'] as const;
export type Rail = (typeof RAILS)[number];
