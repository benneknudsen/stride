import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality via `timingSafeEqual` (issue #272).
 *
 * `timingSafeEqual` requires equal-length buffers and throws otherwise, so a
 * length check short-circuits first — leaking only the length, never the
 * content, which is the standard trade-off. Extracted from the Strava webhook
 * route so every secret comparison (webhook verify token, OAuth state, …)
 * shares one audited implementation instead of per-route copies.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
