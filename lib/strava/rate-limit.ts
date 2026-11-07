import { rateLimit } from "@/lib/rate-limit";

type RateLimitResult = Awaited<ReturnType<typeof rateLimit>>;

/**
 * One full Strava sync per user per minute (issue #359).
 *
 * Both the manual sync route and the post-connect callback spend from this
 * budget, so a connect cannot stack a second expensive sync on top of one that
 * just ran. Keeping the key and window here stops the two callers from drifting
 * apart.
 */
export const STRAVA_SYNC_RATE_LIMIT = { max: 1, windowMs: 60_000 } as const;

export function stravaSyncRateLimitKey(userId: string): string {
  return `strava-sync:${userId}`;
}

/** Spends one slot of the per-user sync budget and reports the result. */
export function consumeStravaSyncBudget(userId: string): Promise<RateLimitResult> {
  return rateLimit(stravaSyncRateLimitKey(userId), STRAVA_SYNC_RATE_LIMIT);
}

/**
 * Rejection for a callback that arrived while the user's sync budget was spent.
 * The message stays the repo's plain error convention ("rate_limited"), while
 * `retryAfterSeconds` gives a caller/UI something actionable to show.
 */
export class StravaSyncRateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(resetAt: number, now: number = Date.now()) {
    super("rate_limited");
    this.name = "StravaSyncRateLimitedError";
    this.retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  }
}
