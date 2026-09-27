import { isWithin, mandateScopeSchema } from '@aperture/core';
import { JwsError, verifyJws, type Jwk } from '@aperture/crypto';

/*
 * Offline mandate verification (plan/architecture §10): anyone holding a mandate JWS and the
 * org's published JWKS can check it without asking Aperture — the signature, the validity
 * window, and, given the parents, that each delegation only narrowed authority (P2).
 */

export type MandateCheck =
  | { ok: true; id: string; subject: string; issuer: string; purpose: string; depth: number }
  | { ok: false; reason: string };

interface Claims {
  jti: string;
  sub: string;
  iss: string;
  parent?: string;
  nbf: number;
  exp: number;
  scope: unknown;
}

function claimsOf(jws: string, jwks: { keys: readonly Jwk[] }): Claims {
  const { header, payload } = verifyJws(jws, jwks);
  if (header.typ !== 'aperture-mandate+jwt') throw new JwsError('unsupported', 'not an Aperture mandate');
  const { jti, sub, iss, nbf, exp } = payload;
  if (typeof jti !== 'string' || typeof sub !== 'string' || typeof iss !== 'string') {
    throw new JwsError('malformed', 'missing jti, sub or iss');
  }
  if (typeof nbf !== 'number' || typeof exp !== 'number') throw new JwsError('malformed', 'missing nbf or exp');
  return {
    jti,
    sub,
    iss,
    nbf,
    exp,
    scope: payload.scope,
    ...(typeof payload.parent === 'string' ? { parent: payload.parent } : {}),
  };
}

/**
 * Verifies `jws` and, when given, its ancestors (`parents`, nearest first). Revocation is not
 * visible offline: a valid result means "was issued like this and hasn't expired".
 */
export function verifyMandate(
  jws: string,
  jwks: { keys: readonly Jwk[] },
  options: { parents?: readonly string[]; now?: Date } = {},
): MandateCheck {
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  try {
    const chain = [jws, ...(options.parents ?? [])].map((token) => claimsOf(token.trim(), jwks));
    for (const [index, claims] of chain.entries()) {
      const label = index === 0 ? 'the mandate' : `parent ${String(index)}`;
      if (now < claims.nbf) return { ok: false, reason: `${label} is not valid yet` };
      if (now >= claims.exp) return { ok: false, reason: `${label} has expired` };
      const scope = mandateScopeSchema.safeParse(claims.scope);
      if (!scope.success) return { ok: false, reason: `${label} has an invalid scope` };
      const parent = chain[index + 1];
      if (parent === undefined) {
        if (claims.parent !== undefined && options.parents !== undefined) {
          return { ok: false, reason: `${label} names parent ${claims.parent}, which was not supplied` };
        }
        continue;
      }
      if (claims.parent !== parent.jti) return { ok: false, reason: `${label} was not delegated from the next token` };
      if (claims.iss !== parent.iss) return { ok: false, reason: `${label} and its parent come from different orgs` };
      const parentScope = mandateScopeSchema.parse(parent.scope);
      const within = isWithin(scope.data, parentScope);
      if (!within.ok) return { ok: false, reason: `${label} exceeds its parent: ${within.violations.join('; ')}` };
    }
    const first = chain[0];
    if (first === undefined) return { ok: false, reason: 'no mandate' };
    const scope = mandateScopeSchema.parse(first.scope);
    return {
      ok: true,
      id: first.jti,
      subject: first.sub,
      issuer: first.iss,
      purpose: scope.purpose,
      depth: chain.length,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid' };
  }
}
