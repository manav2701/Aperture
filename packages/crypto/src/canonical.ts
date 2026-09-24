import canonicalize from 'canonicalize';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJson(item, `${path}[${String(index)}]`);
    });
    return;
  }
  const prototype: unknown = typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (typeof value === 'object' && (prototype === Object.prototype || prototype === null)) {
    for (const [key, item] of Object.entries(value)) assertJson(item, `${path}.${key}`);
    return;
  }
  // bigint, undefined, functions, Dates, class instances: callers must convert explicitly
  // (money as decimal strings, times as ISO strings) so the canonical form is unambiguous.
  throw new CanonicalJsonError(`${path}: ${typeof value} is not plain JSON`);
}

/** RFC 8785 JSON Canonicalization Scheme: one byte-exact encoding for equal JSON values. */
export function canonicalJson(value: JsonValue): string {
  assertJson(value, '$');
  const encoded = canonicalize(value);
  if (encoded === undefined) throw new CanonicalJsonError('value has no JSON encoding');
  return encoded;
}
