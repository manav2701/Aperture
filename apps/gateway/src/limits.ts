/**
 * In-process request limits per key (or workspace principal) and per org: concurrent requests,
 * and requests per minute (token bucket). They protect upstream accounts from runaway agents;
 * money is protected by the ledger, not by these.
 */
export interface LimitSettings {
  perKeyConcurrency: number;
  perOrgConcurrency: number;
  perKeyPerMinute: number;
}

const DEFAULT_LIMITS: LimitSettings = { perKeyConcurrency: 20, perOrgConcurrency: 100, perKeyPerMinute: 600 };

export class RequestLimiter {
  private readonly active = new Map<string, number>();
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(private readonly settings: LimitSettings = DEFAULT_LIMITS) {}

  /** Returns a release function, or undefined when the caller is over a limit. */
  acquire(keyId: string, orgId: string, now = Date.now()): (() => void) | undefined {
    const bucket = this.buckets.get(keyId) ?? { tokens: this.settings.perKeyPerMinute, updated: now };
    bucket.tokens = Math.min(
      this.settings.perKeyPerMinute,
      bucket.tokens + ((now - bucket.updated) / 60_000) * this.settings.perKeyPerMinute,
    );
    bucket.updated = now;
    if (bucket.tokens < 1) {
      this.buckets.set(keyId, bucket);
      return undefined;
    }
    const keyActive = this.active.get(`k:${keyId}`) ?? 0;
    const orgActive = this.active.get(`o:${orgId}`) ?? 0;
    if (keyActive >= this.settings.perKeyConcurrency || orgActive >= this.settings.perOrgConcurrency) return undefined;

    bucket.tokens -= 1;
    this.buckets.set(keyId, bucket);
    this.active.set(`k:${keyId}`, keyActive + 1);
    this.active.set(`o:${orgId}`, orgActive + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.decrement(`k:${keyId}`);
      this.decrement(`o:${orgId}`);
    };
  }

  private decrement(key: string) {
    const next = (this.active.get(key) ?? 1) - 1;
    if (next <= 0) this.active.delete(key);
    else this.active.set(key, next);
  }
}
