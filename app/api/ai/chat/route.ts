/**
 * POST /api/ai/chat — streaming AI coach chat with agent tools.
 *
 * The conversational counterpart to `/api/ai/analyze`. The model is given the
 * chat transcript plus four typed tools that expose the coach rule engine
 * (`recommendWorkout`, `getProgression`, `getWeekPlan`, `validateWorkout`), so
 * every recommendation is grounded in engine output — the model orchestrates,
 * it never invents numbers. Replies stream as NDJSON: one `ChatReply` fragment
 * per line; clients concatenate `content` to rebuild the answer.
 *
 * Gating mirrors the analyze route: without a configured provider the endpoint
 * streams a scripted Danish notice (the public demo), with a provider it
 * requires a session (401) and rate-limits per user. Provider routing tries
 * each `getModelCandidates()` entry in order until one streams output.
 *
 * Conversation history is persisted per user (issue #74): the route loads the
 * newest `MAX_CONTEXT_MESSAGES` from `chat_messages` as model context and
 * appends the user/assistant turn after a successful stream. Both reads and
 * writes are best-effort — a DB outage degrades the chat to stateless, it
 * never breaks the route.
 *
 * Keys never reach the browser — the model is only touched server-side here.
 */

import { track } from "@vercel/analytics/server";
import { stepCountIs, streamText } from "ai";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildCoachTools, type CoachChatActivity } from "@/lib/ai/coach-tools";
import { getModelCandidates, isAIConfigured } from "@/lib/ai/provider";
import { auth } from "@/lib/auth";
import {
  getChatHistory,
  getDashboardActivities,
  getRacePlan,
  insertChatMessage,
} from "@/lib/db/queries";
import { demoActivities } from "@/lib/demo/data";
import { captureError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import type { ChatReply } from "@/types/chat";

export const runtime = "nodejs";
// Tool loop (up to MAX_STEPS model round-trips) needs more headroom than the
// single-pass analyze route's 30 s.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

/** Upper bound on a single message's content length (issue #169). */
const MAX_MESSAGE_LENGTH = 4000;
/** Upper bound on messages accepted per request (issue #169). */
const MAX_REQUEST_MESSAGES = 50;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_MESSAGE_LENGTH),
});

const requestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(MAX_REQUEST_MESSAGES),
});

// ---------------------------------------------------------------------------
// Limits & headers
// ---------------------------------------------------------------------------

/** Per-user chat rate limit: 30 requests per 60 seconds. */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Upper bound on model round-trips in the tool loop. Four tools exist, and
 * chained calls beyond that are usually the model looping rather than a
 * grounded answer (issue #198). */
const MAX_STEPS = 4;

/**
 * Time budget derived from `maxDuration` so the hard limits can never drift
 * apart (issue #198). `maxDuration` is the absolute ceiling Vercel enforces;
 * we leave 25 % headroom for request setup, JSON parsing, tool execution, and
 * stream teardown.
 *
 * - `FIRST_TOKEN_TIMEOUT_MS`: per-candidate abort if the provider streams
 *   nothing (no text, no tool call) within this window. A fresh window per
 *   candidate so the fallback model gets its own chance.
 * - `TOTAL_BUDGET_MS`: hard cap for the whole response, including all tool
 *   rounds. When this fires the active candidate is aborted and a truncation
 *   marker is streamed instead of persisting a half answer.
 */
const MAX_DURATION_MS = maxDuration * 1000; // 60_000
const FIRST_TOKEN_TIMEOUT_MS = Math.floor(MAX_DURATION_MS * 0.25); // 15_000
const TOTAL_BUDGET_MS = Math.floor(MAX_DURATION_MS * 0.75); // 45_000

/** Cap on messages sent to the model (persisted history + this turn). */
const MAX_CONTEXT_MESSAGES = 50;

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

// ---------------------------------------------------------------------------
// Scripted replies (no provider / every provider failed)
// ---------------------------------------------------------------------------

const NOT_CONFIGURED_REPLY: ChatReply = {
  role: "assistant",
  content:
    "AI coachen er ikke aktiveret endnu — der er ikke sat en AI-nøgle op. Indtil da kan du se dit næste pas på Coach-dashboardet.",
};

const PROVIDER_DOWN_REPLY: ChatReply = {
  role: "assistant",
  content:
    "Coachen kunne ikke svare lige nu — prøv igen om et øjeblik. Dit næste pas står stadig klar på Coach-dashboardet.",
};

/** Appended to an answer that was cut off by the total budget or a provider error after it started streaming (issue #198). */
const TRUNCATED_REPLY: ChatReply = {
  role: "assistant",
  content: "\n\n[Svaret blev afbrudt — prøv igen om et øjeblik.]",
};

/** Stream an already-resolved set of replies (scripted fallback) as NDJSON. */
function ndjsonResponse(replies: ChatReply[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const reply of replies) {
        controller.enqueue(encoder.encode(`${JSON.stringify(reply)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const COACH_SYSTEM_PROMPT = `Du er Stride — brugerens personlige løbecoach. Du giver træningsråd baseret på brugerens egne data og planens regelmotor.

Regler:
- Svar altid på dansk og sig "du" til brugeren.
- Brug ALTID dine tools til at hente data — gæt aldrig, og opdig aldrig tal. Alt du siger om form, belastning og pas skal komme fra tool-output. Tools læser selv brugerens synkroniserede aktiviteter — du skal ikke levere dem.
- Brug recommendWorkout når du skal anbefale næste pas.
- Brug getProgression når du skal forstå brugerens form og belastning.
- Brug getWeekPlan når du skal kende ugens struktur.
- Brug validateWorkout når du skal tjekke om et foreslået pas er forsvarligt.
- Vær motiverende, men ærlig — pynt ikke på tallene.
- Forklar kort hvorfor du giver et råd (1-2 sætninger).
- Sleep data findes ikke i produktet og må aldrig indgå i dine råd.`;

/** Appended when the user has nothing synced yet, so the coach never passes
 * demo numbers off as the user's own training. */
const DEMO_DATA_NOTE = `
- VIGTIGT: Brugeren har endnu ingen synkroniserede aktiviteter, så dine tools læser produktets demodata. Gør altid opmærksom på det, når du refererer til tallene, og anbefal at forbinde Strava.`;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

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

  // The schema permits role: "assistant" turns (diagnostics/audit), so a
  // payload of only assistant messages parses. Reject it here: without a user
  // turn there is nothing to answer, and `latest` would be undefined downstream.
  if (!parsed.data.messages.some((message) => message.role === "user")) {
    return Response.json({ error: "user_message_required" }, { status: 400 });
  }

  // No provider → scripted notice for the public demo, no auth required.
  if (!isAIConfigured()) {
    return ndjsonResponse([NOT_CONFIGURED_REPLY]);
  }

  // Live AI key configured → require authentication to prevent cost abuse.
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  const limit = await rateLimit(`chat:${userId}`, {
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

  // The message is authorized (provider up, authed, within rate limit) and about
  // to be answered — an anonymous count of coach turns, no user id or content.
  track("coach_besked_sendt").catch(() => {});

  const now = new Date();
  // Resolve the user's race AND their real synced activities once, and bind
  // both into the tools. The demo fixtures are the fallback for users with
  // nothing synced yet (the #84 pattern) — flagged to the model so it never
  // presents demo numbers as the user's own training.
  // Persisted history is the canonical context (issue #74) — the client only
  // holds the current session's transcript. When the DB has nothing (new user,
  // or best-effort read failed) fall back to the client transcript so the
  // model still sees this session. Cap to the newest MAX_CONTEXT_MESSAGES.
  const [racePlan, rows, history] = await Promise.all([
    getRacePlan(userId),
    // Best-effort like the chat history reads: a cache/DB outage degrades the
    // coach to the demo fixtures, it never breaks the route.
    getDashboardActivities(userId).catch(() => []),
    getChatHistory(userId, MAX_CONTEXT_MESSAGES).catch(() => []),
  ]);
  const usingDemoData = rows.length === 0;
  const activities: CoachChatActivity[] = usingDemoData ? demoActivities : rows;
  // Building the tools is the last synchronous step before the stream, and it
  // reduces real DB rows — so a bad row here used to take the whole route down
  // with a 500 (a raw ISO date reaching `.getTime()`, #190/#194/#195). Every
  // other dependency on this path degrades instead of throwing; this one now
  // does too: the user gets the scripted floor, and the cause lands in Sentry
  // rather than in an opaque 500.
  let tools: ReturnType<typeof buildCoachTools>;
  try {
    tools = buildCoachTools(userId, now, racePlan, activities);
  } catch (err) {
    captureError("api.ai.chat.build_tools", err);
    return ndjsonResponse([PROVIDER_DOWN_REPLY]);
  }
  const systemPrompt = usingDemoData ? COACH_SYSTEM_PROMPT + DEMO_DATA_NOTE : COACH_SYSTEM_PROMPT;
  const incoming = parsed.data.messages;
  // The client may send role: "assistant" messages (schema allows it for
  // diagnostics/audit), but those must never be trusted as model context —
  // only the client's own "user" turns and the DB-persisted history are.
  const clientContextMessages = incoming.filter((message) => message.role === "user");
  const latest = clientContextMessages[clientContextMessages.length - 1];

  const messages = (
    history.length > 0 && latest ? [...history, latest] : clientContextMessages
  ).slice(-MAX_CONTEXT_MESSAGES);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let sawActivity = false;
      let isTruncated = false;
      let activeAbortController: AbortController | null = null;
      let budgetExceeded = false;

      const emit = (reply: ChatReply) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(reply)}\n`));
      };

      const budgetTimer = setTimeout(() => {
        budgetExceeded = true;
        activeAbortController?.abort();
      }, TOTAL_BUDGET_MS);

      // Provider router with fallback: try each model until one streams output.
      for (const { id, model } of getModelCandidates()) {
        if (sawActivity || budgetExceeded) break;

        const candidateController = new AbortController();
        activeAbortController = candidateController;

        let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          if (!sawActivity) {
            candidateController.abort(new Error("first token timeout"));
          }
        }, FIRST_TOKEN_TIMEOUT_MS);

        const noteActivity = () => {
          sawActivity = true;
          if (firstTokenTimer) {
            clearTimeout(firstTokenTimer);
            firstTokenTimer = null;
          }
        };

        try {
          const result = streamText({
            model,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            abortSignal: candidateController.signal,
            onError: ({ error }) => {
              captureProviderError("stream", id, error);
            },
          });
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              noteActivity();
              if (part.text.length === 0) continue;
              answer += part.text;
              emit({ role: "assistant", content: part.text });
            } else if (
              part.type === "tool-call" ||
              part.type === "tool-result" ||
              part.type === "tool-input-start"
            ) {
              // Tool-only activity counts as a response so we do not fall back
              // to another candidate, but it does not emit text by itself.
              noteActivity();
            }
            // `part.type === "error"` needs no branch: `onError` above already
            // reports it. What matters is that it does NOT throw — see below.
          }
          // Only stop routing once a candidate actually produced something.
          // A provider that fails politely (bad model id, no endpoint that
          // supports tool calls, quota) surfaces the failure as an `error`
          // part, and `onError` keeps it from ever reaching the catch — so the
          // stream simply ends. Breaking unconditionally here treated that as
          // an answer: the fallback model was never tried and every such
          // failure became the scripted floor.
          if (sawActivity) break;
        } catch (err) {
          // Timed out before first token, total budget reached, or provider
          // error. If the model already produced output we must not retry:
          // the user would get two interleaved answers; instead close the
          // stream with a truncation marker.
          captureProviderError("catch", id, err);
          if (sawActivity) {
            isTruncated = true;
            break;
          }
        } finally {
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
          activeAbortController = null;
        }
      }

      clearTimeout(budgetTimer);

      if (isTruncated) {
        // Partial answer was already streamed; warn the user and do NOT keep
        // the half turn in the persisted history (issue #198).
        emit(TRUNCATED_REPLY);
      } else if (!sawActivity) {
        captureError(
          "api.ai.chat.all_providers_failed",
          new Error("All AI provider candidates failed; returning scripted floor")
        );
        emit(PROVIDER_DOWN_REPLY);
      }

      // Persist only complete model answers. Scripted floors and truncated
      // answers stay out of history so retried questions don't duplicate.
      if (answer.length > 0 && !isTruncated) {
        if (latest?.role === "user") {
          await insertChatMessage({ userId, role: "user", content: latest.content });
        }
        await insertChatMessage({ userId, role: "assistant", content: answer });
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

/** Resolve the signed-in user id, or null (unauthenticated). */
async function currentUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch (err) {
    captureError("api.ai.chat.auth", err);
    return null;
  }
}

/** Capture a provider error with the model id so incidents are debuggable. */
function captureProviderError(phase: "stream" | "catch", modelId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const error = new Error(`AI chat provider ${modelId} failed during ${phase}: ${message}`);
  error.name = "ChatProviderError";
  error.cause = err;
  captureError("api.ai.chat.provider", error);
}
