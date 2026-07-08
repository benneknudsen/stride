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

import { stepCountIs, streamText, tool } from "ai";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getModelCandidates, isAIConfigured } from "@/lib/ai/provider";
import { auth } from "@/lib/auth";
import {
  getCurrentPhase,
  getWeekPlan,
  type SessionType,
  serializeValidationResult,
  validateWorkout,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { recommendWorkout } from "@/lib/coach/recommender";
import { getChatHistory, insertChatMessage } from "@/lib/db/queries";
import { rateLimit } from "@/lib/rate-limit";
import { GOALS } from "@/lib/training/goals";
import {
  computeSnapshot,
  type ProgressionActivityInput,
  type ProgressionSnapshot,
} from "@/lib/training/progression";
import type { ChatReply } from "@/types/chat";

export const runtime = "nodejs";
// Tool loop (up to MAX_STEPS model round-trips) needs more headroom than the
// single-pass analyze route's 30 s.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const requestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

// ---------------------------------------------------------------------------
// Limits & headers
// ---------------------------------------------------------------------------

/** Per-user chat rate limit: 30 requests per 60 seconds. */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Upper bound on model round-trips in the tool loop. */
const MAX_STEPS = 8;

/** Cap on messages sent to the model (persisted history + this turn). */
const MAX_CONTEXT_MESSAGES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

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
    "AI coachen er ikke aktiveret endnu. Når Benjamin sætter en AI-nøgle på, kan jeg give dig personlige træningsråd. Indtil da kan du se dit næste pas på Coach-dashboardet.",
};

const PROVIDER_DOWN_REPLY: ChatReply = {
  role: "assistant",
  content:
    "Coachen kunne ikke svare lige nu — prøv igen om et øjeblik. Dit næste pas står stadig klar på Coach-dashboardet.",
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
- Brug ALTID dine tools til at hente data — gæt aldrig, og opdig aldrig tal. Alt du siger om form, belastning og pas skal komme fra tool-output.
- Brug recommendWorkout når du skal anbefale næste pas.
- Brug getProgression når du skal forstå brugerens form og belastning.
- Brug getWeekPlan når du skal kende ugens struktur.
- Brug validateWorkout når du skal tjekke om et foreslået pas er forsvarligt.
- Vær motiverende, men ærlig — pynt ikke på tallene.
- Forklar kort hvorfor du giver et råd (1-2 sætninger).
- Sleep data findes ikke i produktet og må aldrig indgå i dine råd.`;

// ---------------------------------------------------------------------------
// Agent tools — thin, validated adapters over the coach engine (the SSOT)
// ---------------------------------------------------------------------------

const SESSION_TYPES = [
  "easy",
  "recovery",
  "tempo",
  "intervals",
  "fartlek",
  "speed",
  "long",
  "race",
  "rest",
  "strength",
  "cross",
  "off",
  "mobility",
  "yoga",
] as const satisfies readonly SessionType[];

const GOAL_KEYS = ["c25k", "marathon", "zone2", "efficient"] as const;

const isoDate = z.string().describe("ISO 8601 date string");

/** The snapshot fields the recommender actually reads, JSON-friendly. */
const progressionInputSchema = z
  .object({
    hasFullWindow: z.boolean(),
    readyToIncrease: z.boolean().nullable(),
    paceEfficiency: z.number().nullable(),
  })
  .describe("Progression snapshot from getProgression (subset)");

/** Inflate the tool-input subset into a full `ProgressionSnapshot`. */
function toSnapshot(
  input: z.infer<typeof progressionInputSchema> | undefined,
  now: Date
): ProgressionSnapshot {
  return {
    date: now,
    hasFullWindow: input?.hasFullWindow ?? false,
    paceEfficiency: input?.paceEfficiency ?? null,
    hrStability: null,
    trainingLoad: { acute: 0, chronic: null, ratio: null, risk: null },
    zone2Percent: null,
    volumeKm: null,
    readyToIncrease: input?.readyToIncrease ?? null,
  };
}

function buildCoachTools(userId: string, now: Date) {
  return {
    recommendWorkout: tool({
      description:
        "Anbefal brugerens næste pas som et workout card (type, distance, pace, pulsloft, sko, begrundelse, ugestrimmel). Hent progression med getProgression først.",
      inputSchema: z.object({
        lastRun: isoDate.optional().describe("Start of the user's most recent run"),
        goal: z.enum(GOAL_KEYS).describe("The user's training goal"),
        progression: progressionInputSchema.optional(),
        footballYesterday: z.boolean().default(false),
        injuryHistory: z.boolean().default(false),
        pauseDays: z
          .number()
          .min(0)
          .optional()
          .describe("Days since the last run, when the exact lastRun date is unknown"),
      }),
      execute: async ({
        lastRun,
        goal,
        progression,
        footballYesterday,
        injuryHistory,
        pauseDays,
      }) => {
        const lastRunDate = lastRun
          ? new Date(lastRun)
          : new Date(now.getTime() - (pauseDays ?? 2) * DAY_MS);
        return recommendWorkout(
          {
            userId,
            goal: GOALS[goal],
            progression: toSnapshot(progression, now),
            lastRun: lastRunDate,
            footballYesterday,
            injuryHistory,
          },
          now
        );
      },
    }),

    getProgression: tool({
      description:
        "Beregn brugerens progressionssnapshot (hasFullWindow, pace efficiency, training load, zone 2-andel, volumen) ud fra en liste af aktiviteter.",
      inputSchema: z.object({
        activities: z
          .array(
            z.object({
              startDate: isoDate,
              distance: z.number().describe("Distance in meters"),
              movingTime: z.number().describe("Moving time in seconds"),
              averageHeartrate: z.number().nullable().optional(),
              type: z.string().default("Run").describe("Strava activity type"),
            })
          )
          .min(1),
      }),
      execute: async ({ activities }) => {
        const inputs: ProgressionActivityInput[] = activities.map((a) => ({
          type: a.type,
          distance: a.distance,
          movingTime: a.movingTime,
          averageHeartrate: a.averageHeartrate ?? null,
          hrZones: null,
          startDate: new Date(a.startDate),
        }));
        return computeSnapshot(inputs, now);
      },
    }),

    getWeekPlan: tool({
      description:
        "Ugens planlagte pas (man-søn) for en træningsfase. Udelad phase for at bruge den aktuelle fase.",
      inputSchema: z.object({
        phase: z.enum(["adapt", "burn", "sharpen", "peak"]).optional(),
        monday: isoDate.optional().describe("The Monday the week starts on"),
      }),
      execute: async ({ phase, monday }) =>
        getWeekPlan(phase ?? getCurrentPhase(now), monday ? new Date(monday) : undefined),
    }),

    validateWorkout: tool({
      description:
        "Valider et foreslået pas mod regelmotorens constraints (puls, restitution, sko, lang tur, fodbold, ugeprogression). Returnerer blokerende issues og advarsler.",
      inputSchema: z.object({
        plannedDate: isoDate,
        plannedType: z.enum(SESSION_TYPES).optional(),
        plannedDistanceKm: z.number().optional(),
        plannedZone: z.number().optional().describe("Target HR zone, 1-5"),
        shoeType: z.string().optional().describe('e.g. "vomero" or "adios_pro"'),
        includesStrength: z.boolean().optional(),
        lastRunDate: isoDate.optional(),
        footballYesterday: z.boolean().optional(),
        phase: z.enum(["adapt", "burn", "sharpen", "peak"]).optional(),
        weeklyDistanceKm: z.number().optional(),
        previousWeekDistanceKm: z.number().optional(),
      }),
      execute: async (input) => {
        const context: WorkoutContext = {
          ...input,
          plannedDate: new Date(input.plannedDate),
          lastRunDate: input.lastRunDate ? new Date(input.lastRunDate) : undefined,
          phase: input.phase ?? getCurrentPhase(now),
        };
        return serializeValidationResult(validateWorkout(context));
      },
    }),
  };
}

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

  // No provider → scripted notice for the public demo, no auth required.
  if (!isAIConfigured()) {
    return ndjsonResponse([NOT_CONFIGURED_REPLY]);
  }

  // Live AI key configured → require authentication to prevent cost abuse.
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  const limit = rateLimit(`chat:${userId}`, {
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

  const now = new Date();
  const tools = buildCoachTools(userId, now);
  const incoming = parsed.data.messages;
  const latest = incoming[incoming.length - 1];

  // Persisted history is the canonical context (issue #74) — the client only
  // holds the current session's transcript. When the DB has nothing (new user,
  // or best-effort read failed) fall back to the client transcript so the
  // model still sees this session. Cap to the newest MAX_CONTEXT_MESSAGES.
  const history = await getChatHistory(userId, MAX_CONTEXT_MESSAGES);
  const messages = (history.length > 0 ? [...history, latest] : incoming).slice(
    -MAX_CONTEXT_MESSAGES
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = 0;
      let answer = "";
      const emit = (reply: ChatReply) => {
        emitted += 1;
        controller.enqueue(encoder.encode(`${JSON.stringify(reply)}\n`));
      };

      // Provider router with fallback: try each model until one streams output.
      for (const { model } of getModelCandidates()) {
        if (emitted > 0) break;
        try {
          const result = streamText({
            model,
            system: COACH_SYSTEM_PROMPT,
            messages,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
          });
          for await (const delta of result.textStream) {
            if (delta.length === 0) continue;
            answer += delta;
            emit({ role: "assistant", content: delta });
          }
          break;
        } catch {
          // Already streamed part of this model's output → cannot safely retry.
          if (emitted > 0) break;
          // Otherwise fall through to the next candidate.
        }
      }

      // Every provider failed before emitting → scripted floor.
      if (emitted === 0) emit(PROVIDER_DOWN_REPLY);

      // Persist the completed round (best-effort, inserts swallow DB errors).
      // Only on a real model answer — the scripted floor stays out of history
      // so a retried question doesn't accumulate duplicate user turns.
      if (answer.length > 0) {
        if (latest.role === "user") {
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
  } catch {
    return null;
  }
}
