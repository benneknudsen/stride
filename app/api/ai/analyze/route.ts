/**
 * POST /api/ai/analyze — streaming generative-UI analysis.
 *
 * The centerpiece endpoint. It reduces the athlete's activities to a compact
 * summary, dedupes against the `ai_analyses` cache by `inputHash`, then streams
 * typed analysis blocks as newline-delimited JSON (NDJSON) — one validated
 * block per line, rendered the instant it arrives.
 *
 * Provider routing: each model in `getModelCandidates()` is tried in order; if
 * the primary errors before emitting anything, the fallback takes over. If no
 * provider is configured (the public demo) or every provider fails, a
 * deterministic heuristic analysis is streamed instead, so the panel always
 * renders something grounded in real data.
 *
 * Keys never reach the browser — this is the only place the model is touched.
 */

import { streamObject } from "ai";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  ANALYSIS_SYSTEM_PROMPT,
  type AnalysisActivity,
  analysisInputHash,
  buildAnalysisInput,
  buildAnalysisPrompt,
  heuristicBlocks,
} from "@/lib/ai/analysis";
import { getModelCandidates, isAIConfigured } from "@/lib/ai/provider";
import {
  type AnalysisBlock,
  analysisBlockSchema,
  blockToToolCall,
  toolCallToBlock,
} from "@/lib/ai/tools";
import { auth } from "@/lib/auth";
import { getCachedAnalysis, insertAnalysis } from "@/lib/db/queries";
import { rateLimit } from "@/lib/rate-limit";
import type { AnalysisToolCall } from "@/types/domain";

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
 * Upper bound on streamed blocks per response. The prompt asks for 3–5; this
 * caps a model that ignores the instruction so a runaway stream can't inflate
 * response size or token spend.
 */
const MAX_BLOCKS = 8;

/** Per-user analyze rate limit: 15 live-AI requests per 60 seconds. */
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Per-candidate stream timeout (issue #71 E3). If a model accepts the request
 * but then stalls without streaming, this aborts it so the router falls through
 * to the next candidate (or the heuristic floor) instead of burning the whole
 * `maxDuration`. Two candidates × 12 s stays inside the 30 s budget. A fresh
 * signal is minted per candidate so each gets its own clean window.
 */
const PROVIDER_TIMEOUT_MS = 12_000;

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

/** Stream an already-resolved set of blocks (cache hit / heuristic) as NDJSON. */
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
  const activities: AnalysisActivity[] = rawActivities.map((a) => ({
    ...a,
    startDate: new Date(a.startDate),
  }));

  const input = buildAnalysisInput(activities, scope, new Date());
  const inputHash = analysisInputHash(input);

  // Best-effort auth — the demo has no session, and that's fine.
  const userId = await currentUserId();

  // Cache lookup (inputHash dedup). Safe no-op without a DB / session.
  if (userId) {
    const cached = await getCachedAnalysis(userId, scope, inputHash);
    const cachedBlocks = parseCachedBlocks(cached?.toolCalls);
    if (cachedBlocks.length > 0) {
      return ndjsonResponse(cachedBlocks);
    }
  }

  // No provider → deterministic, data-grounded analysis for the demo.
  if (!isAIConfigured()) {
    return ndjsonResponse(heuristicBlocks(input));
  }

  // Live AI key configured → require authentication to prevent cost abuse.
  if (!userId) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  // Per-user rate limit on the live-AI path (cache hits above never reach here),
  // mirroring the chat route: 429 with a `retry-after` when the window is full.
  const limit = rateLimit(`analyze:${userId}`, {
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

  const prompt = buildAnalysisPrompt(input);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const collected: AnalysisBlock[] = [];
      const emit = (block: AnalysisBlock) => {
        collected.push(block);
        controller.enqueue(encoder.encode(`${JSON.stringify(block)}\n`));
      };

      let usedModel: string | null = null;

      // Provider router with fallback: try each model until one streams output.
      for (const { id, model } of getModelCandidates()) {
        if (collected.length > 0) break;
        try {
          const result = streamObject({
            model,
            output: "array",
            schema: analysisBlockSchema,
            system: ANALYSIS_SYSTEM_PROMPT,
            prompt,
            abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          });
          for await (const block of result.elementStream) {
            emit(block);
            if (collected.length >= MAX_BLOCKS) break;
          }
          usedModel = id;
          break;
        } catch {
          // Timed out (E3) or errored. Already streamed part of this model's
          // output → cannot safely retry; otherwise fall through to the next.
          if (collected.length > 0) break;
        }
      }

      // Every provider failed before emitting → guaranteed heuristic floor.
      if (collected.length === 0) {
        for (const block of heuristicBlocks(input)) emit(block);
        usedModel = null;
      }

      // Persist a clean model result for inputHash dedup (best-effort). Awaited
      // BEFORE closing the stream (issue #71 E5): on Vercel the function can be
      // frozen the instant the response ends, which would truncate a persist
      // awaited *after* `controller.close()`. Writing while the stream is still
      // open keeps the request alive until the insert lands — the same ordering
      // the chat route uses. Caching is an optimisation, so failures never
      // surface to the client.
      if (userId && usedModel && collected.length > 0) {
        try {
          await insertAnalysis({
            userId,
            scope,
            inputHash,
            model: usedModel,
            toolCalls: collected.map(blockToToolCall),
          });
        } catch {
          // Caching is an optimisation; never fail the request over it.
        }
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
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

/** Rehydrate cached `{ name, args }` tool calls into validated blocks. */
function parseCachedBlocks(toolCalls: unknown): AnalysisBlock[] {
  if (!Array.isArray(toolCalls)) return [];
  return (toolCalls as AnalysisToolCall[])
    .map((call) => toolCallToBlock(call))
    .filter((b): b is AnalysisBlock => b !== null);
}
