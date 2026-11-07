import { peekRateLimit, rateLimit } from "@/lib/rate-limit";

type RateLimitResult = Awaited<ReturnType<typeof rateLimit>>;

/**
 * One full Strava sync per user per minute (issue #359).
 *
 * Three paths spend from this budget so they cannot stack expensive syncs on
 * top of each other: the manual sync route (`POST /api/strava/sync`), the
 * post-connect callback (`handleStravaCallback`), and the Strava sign-in event
 * (`events.signIn` in `lib/auth.ts`). Keeping the key and window here stops the
 * callers from drifting apart.
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
 * Checks whether the per-user sync budget has a slot left without spending it.
 *
 * The callback must reject a spent budget before calling Strava's token
 * endpoint, but a failed token exchange must not burn the user's only slot
 * (issue #366). So it peeks here first and spends with
 * `consumeStravaSyncBudget` only after the exchange succeeds.
 */
export function checkStravaSyncBudget(userId: string): Promise<RateLimitResult> {
  return peekRateLimit(stravaSyncRateLimitKey(userId), STRAVA_SYNC_RATE_LIMIT);
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
