/**
 * Fixed-window rate limiter backed by Upstash Redis, with an in-memory fallback.
 *
 * The Map-based limiter this replaces (#88) was process-local: on Vercel every
 * function instance kept its own counters, so the real limit was N× the
 * configured one and reset on every cold start — worst on exactly the endpoints
 * it guards (AI chat/analyze, provider syncs).
 *
 * Redis is used whenever UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
 * set (Vercel Marketplace provisions both). Without them — local dev, tests —
 * it degrades to the old Map. A Redis error also degrades to the Map rather
 * than failing the request open: still limited, just per-instance.
 */

import { Redis } from "@upstash/redis";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Prevent unbounded growth on the fallback Map by sweeping expired
 *  buckets once the map exceeds this threshold (#107). Active keys
 *  within their window are never evicted — the ceiling is rate × window. */
const MAX_BUCKETS = 10_000;

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

let redis: Redis | null = null;
let redisResolved = false;

/** Lazily builds the Redis client. Read at call time so tests can vary the env. */
function getRedis(): Redis | null {
  if (redisResolved) return redis;
  redisResolved = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;

  return redis;
}

/**
 * Records a hit for `key` and reports whether it is allowed. Expired windows
 * roll over automatically; the first hit of a new window is always allowed.
 */
export async function rateLimit(
  key: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const { max = 5, windowMs = 10 * 60 * 1000, now = Date.now() } = options;

  const client = getRedis();
  if (!client) return memoryRateLimit(key, max, windowMs, now);

  try {
    return await redisRateLimit(client, key, max, windowMs, now);
  } catch (err) {
    // Redis unreachable — a per-instance limit beats no limit at all. Upstash
    // errors carry no credentials, so the raw error is safe to log.
    console.error("[rate-limit] Redis failed, falling back to in-memory:", err);
    return memoryRateLimit(key, max, windowMs, now);
  }
}

async function redisRateLimit(
  client: Redis,
  key: string,
  max: number,
  windowMs: number,
  now: number
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;

  // One round trip: bump the counter, arm the expiry if the key has none (NX,
  // so a mid-window hit never extends the window), and read what's left of it.
  // NX also repairs a key left without a TTL by a run that died mid-transaction
  // — without an expiry it would block the caller forever. PTTL runs after the
  // PEXPIRE, so the TTL it reports is always positive.
  const tx = client.multi();
  tx.incr(redisKey);
  tx.pexpire(redisKey, windowMs, "NX");
  tx.pttl(redisKey);
  const [count, , ttl] = await tx.exec<[number, 0 | 1, number]>();

  const resetAt = now + ttl;

  // The counter keeps climbing past `max` while blocked. That is harmless: the
  // window still expires on its original TTL, so the semantics match the Map.
  if (count > max) return { allowed: false, remaining: 0, resetAt };

  return { allowed: true, remaining: max - count, resetAt };
}

function memoryRateLimit(key: string, max: number, windowMs: number, now: number): RateLimitResult {
  const bucket = buckets.get(key);

  // No active window (or it has expired) — start a fresh one.
  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
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

/** Drops expired buckets. Redis does this for us via TTL; the Map cannot. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/**
 * Clears the in-memory state and the cached Redis client. Intended for tests —
 * it does not flush Redis, which owns its own expiry.
 */
export function resetRateLimit(): void {
  buckets.clear();
  redis = null;
  redisResolved = false;
}
