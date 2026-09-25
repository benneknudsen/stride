/**
 * POST /api/ai/analyze — streaming block analysis.
 *
 * Reduces the athlete's activities to a compact summary (`buildAnalysisInput`)
 * and streams typed analysis blocks as newline-delimited JSON (NDJSON) — one
 * validated block per line, rendered the instant it arrives.
 *
 * Every block comes from `heuristicBlocks`, which is arithmetic over the
 * athlete's own numbers: volume trend, pace comparison, a grounded insight, a
 * next session and — when the progression data warrants one — a coach message.
 * There is no model in this path and no provider to configure; the session is
 * read only to size the anonymous payload cap below.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { type AnalysisActivity, buildAnalysisInput, heuristicBlocks } from "@/lib/ai/analysis";
import { type AnalysisBlock, analysisBlockSchema } from "@/lib/ai/tools";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Request schema — a minimal activity subset the client already holds
// ---------------------------------------------------------------------------

const requestActivitySchema = z.object({
  startDate: z.string().describe("ISO date string"),
  distance: z.number(),
  movingTime: z.number(),
  averageSpeed: z.number().nullable().optional(),
  averageHeartrate: z.number().nullable().optional(),
  totalElevationGain: z.number().nullable().optional(),
});

const requestSchema = z.object({
  scope: z.enum(["weekly", "activity", "trend", "overall"]).default("overall"),
  activities: z.array(requestActivitySchema).min(1).max(500),
});

/**
 * Per-IP rate limit. The blocks reduce client-supplied activities, so on the
 * keyless demo deploy this is an unauthenticated compute sink. 30 requests per
 * 60 seconds — generous for a real visitor, cheap to abuse-proof.
 */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Cap on the client-supplied activity payload served to unauthenticated
 * visitors (issue #264). The rate-limit key can be rotated by a client-
 * controlled XFF hop on self-hosted deployments, so the payload itself is
 * capped as defense-in-depth on this unauthenticated compute sink. The authed
 * path keeps the request schema's full 500-activity maximum.
 */
const MAX_ANON_ACTIVITIES = 100;

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

/** Stream an already-resolved set of blocks as NDJSON. */
function ndjsonResponse(blocks: AnalysisBlock[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) {
        controller.enqueue(encoder.encode(`${JSON.stringify(block)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { scope, activities: rawActivities } = parsed.data;

  // Per-IP guard first: nothing below is worth a session read or a payload
  // rewrite for a caller that is already over budget.
  const limit = await rateLimit(`ai-blocks:${clientIp(req)}`, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds) } }
    );
  }

  // Best-effort auth — only to decide how large a payload this caller may send.
  const userId = await currentUserId();
  const activities: AnalysisActivity[] = (
    userId ? rawActivities : rawActivities.slice(0, MAX_ANON_ACTIVITIES)
  ).map((a) => ({
    ...a,
    startDate: new Date(a.startDate),
  }));

  const input = buildAnalysisInput(activities, scope, new Date());

  // The block contract is enforced before a block reaches the stream.
  const blocks: AnalysisBlock[] = [];
  for (const block of heuristicBlocks(input)) {
    const validated = analysisBlockSchema.safeParse(block);
    if (validated.success) blocks.push(validated.data);
  }
  return ndjsonResponse(blocks);
}

/**
 * Best-effort client IP for the rate-limit key, in priority order:
 *
 * 1. `x-real-ip` — set by Vercel's edge proxy (and well-configured reverse
 *    proxies) to the actual connecting address; client-supplied values are
 *    overwritten, so it is trustworthy.
 * 2. The LAST hop of `x-forwarded-for` — the address the nearest append-proxy
 *    observed, matching the `$proxy_add_x_forwarded_for` convention. The FIRST
 *    hop is deliberately ignored: behind append-style proxies it is client-
 *    controlled, so an attacker can rotate it per request and mint a fresh
 *    rate-limit bucket on self-hosted deployments (`trustHost: true` is a
 *    supported config) — a full bypass of the pre-auth guard (issue #264).
 *    Vercel overwrites the header, so first-hop keying only ever looked
 *    correct there.
 * 3. `"unknown"` — a single shared bucket, so a missing header still
 *    rate-limits rather than opening the path up (fail-closed).
 */
export function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }

  return "unknown";
}

/** Resolve the signed-in user id, or null (demo / unauthenticated). */
async function currentUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
