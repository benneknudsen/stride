/**
 * Minimal in-memory, Map-based rate limiter. No external dependencies.
 *
 * Suitable for single-instance / low-scale protection of unauthenticated
 * endpoints (e.g. the magic-link sign-in) against brute-force abuse. State is
 * process-local and resets on redeploy — this is a deliberate trade-off to
 * avoid an external store. For multi-instance production hardening, swap the
 * backing store here without changing callers.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  /** Whether the request is allowed under the current window. */
  allowed: boolean;
  /** Remaining requests in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
};

export type RateLimitOptions = {
  /** Max requests allowed per window. Default 5. */
  max?: number;
  /** Window length in milliseconds. Default 10 minutes. */
  windowMs?: number;
  /** Injectable clock for testing. Default Date.now(). */
  now?: number;
};

/**
 * Records a hit for `key` and reports whether it is allowed. Expired windows
 * roll over automatically; the first hit of a new window is always allowed.
 */
export function rateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const { max = 5, windowMs = 10 * 60 * 1000, now = Date.now() } = options;

  const bucket = buckets.get(key);

  // No active window (or it has expired) — start a fresh one.
  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  // Window is full — block without incrementing further.
  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt };
}

/** Clears all rate-limit state. Intended for tests. */
export function resetRateLimit(): void {
  buckets.clear();
}
