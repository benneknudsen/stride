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
  getLocalDate,
  getWeekPlan,
  SESSION_TYPES,
  serializeValidationResult,
  validateWorkout,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { recommendWorkout } from "@/lib/coach/recommender";
import {
  getChatHistory,
  getDashboardActivities,
  getRacePlan,
  insertChatMessage,
} from "@/lib/db/queries";
import { demoActivities } from "@/lib/demo/data";
import { rateLimit } from "@/lib/rate-limit";
import { GOALS } from "@/lib/training/goals";
import { computeSnapshot, type ProgressionActivityInput } from "@/lib/training/progression";
import type { ChatReply } from "@/types/chat";
import type { HrZone } from "@/types/domain";

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

/** Upper bound on model round-trips in the tool loop. */
const MAX_STEPS = 8;

/**
 * Per-candidate stream timeout (issue #71 E3). Guards against a model that
 * accepts the request then stalls without streaming: the abort lets the router
 * fall through to the next candidate (or the scripted floor) instead of holding
 * the request open to the 60 s `maxDuration`. A fresh signal per candidate.
 */
const PROVIDER_TIMEOUT_MS = 12_000;

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
    "AI coachen er ikke aktiveret endnu — der er ikke sat en AI-nøgle op. Indtil da kan du se dit næste pas på Coach-dashboardet.",
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
- VIGTIGT: Brugeren har endnu ingen synkroniserede aktiviteter, så dine tools læser produktets demodata. Gør altid opmærksom på det, når du refererer til tallene, og anbefal at forbinde Strava eller Garmin.`;

// ---------------------------------------------------------------------------
// Agent tools — thin, validated adapters over the coach engine (the SSOT)
// ---------------------------------------------------------------------------

const GOAL_KEYS = ["c25k", "marathon", "zone2", "efficient"] as const;

const isoDate = z.string().describe("ISO 8601 date string");

/** The activity fields the progression engine reads — DB rows and demo fixtures both fit. */
type CoachChatActivity = {
  type: string;
  startDate: Date;
  distance: number;
  movingTime: number;
  averageHeartrate: number | null;
  hrZones?: HrZone[] | null;
};

function buildCoachTools(
  userId: string,
  now: Date,
  race: { raceDate: Date | null; raceName: string | null } | null | undefined,
  activities: CoachChatActivity[]
) {
  // The user's real synced activities, resolved once by the route and bound
  // into the tools — the model reads data, it never supplies it (so it can
  // neither guess nor fabricate the history it reasons over).
  const progressionInputs: ProgressionActivityInput[] = activities.map((a) => ({
    type: a.type,
    distance: a.distance,
    movingTime: a.movingTime,
    averageHeartrate: a.averageHeartrate ?? null,
    hrZones: a.hrZones ?? null,
    startDate: a.startDate,
  }));
  const latestRun = progressionInputs
    .filter((a) => /run/i.test(a.type))
    .reduce<Date | null>(
      (latest, run) =>
        run.startDate.getTime() <= now.getTime() &&
        (latest === null || run.startDate.getTime() > latest.getTime())
          ? run.startDate
          : latest,
      null
    );
  // E2: resolve "the current phase" from the athlete's Danish calendar day, not
  // the server's UTC one. `now` stays the real instant for the recommender's
  // recovery math; only the day-of read goes through `getLocalDate`.
  const today = getLocalDate(now);
  // Issue #99: the user's race is resolved once by the route and bound into
  // every tool here — the model never sees the date as a free parameter, so it
  // can neither guess nor override which race the plan periodises toward.
  // Null/undefined falls back to the engine's demo defaults.
  const raceDate = race?.raceDate ?? undefined;
  const raceName = race?.raceName ?? undefined;
  return {
    recommendWorkout: tool({
      description:
        "Anbefal brugerens næste pas som et workout card (type, distance, pace, pulsloft, sko, begrundelse, ugestrimmel). Progression og seneste løbetur læses automatisk fra brugerens egne aktiviteter.",
      inputSchema: z.object({
        goal: z
          .enum(GOAL_KEYS)
          .default("zone2")
          .describe("The user's training goal, when they have stated one"),
        footballYesterday: z
          .boolean()
          .default(false)
          .describe("Set true only if the user says they played football yesterday"),
        injuryHistory: z
          .boolean()
          .default(false)
          .describe("Set true only if the user mentions an injury history"),
        risk: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Optional risk read for the session, threaded to the rule engine"),
      }),
      execute: async ({ goal, footballYesterday, injuryHistory, risk }) => {
        // The recommendation is grounded in the user's real history: the
        // progression snapshot and the last-run date both come from the
        // activities the route loaded, never from model-supplied numbers.
        return recommendWorkout(
          {
            userId,
            goal: GOALS[goal],
            progression: computeSnapshot(progressionInputs, now),
            lastRun: latestRun ?? new Date(now.getTime() - 2 * DAY_MS),
            footballYesterday,
            injuryHistory,
            risk,
            raceDate,
          },
          now
        );
      },
    }),

    getProgression: tool({
      description:
        "Beregn brugerens progressionssnapshot (hasFullWindow, pace efficiency, training load, zone 2-andel, volumen) ud fra brugerens egne synkroniserede aktiviteter.",
      inputSchema: z.object({}),
      execute: async () => computeSnapshot(progressionInputs, now),
    }),

    getWeekPlan: tool({
      description:
        "Ugens planlagte pas (man-søn) for en træningsfase. Udelad phase for at bruge den aktuelle fase.",
      inputSchema: z.object({
        phase: z.enum(["adapt", "burn", "sharpen", "peak"]).optional(),
        monday: isoDate.optional().describe("The Monday the week starts on"),
      }),
      execute: async ({ phase, monday }) =>
        getWeekPlan(
          phase ?? getCurrentPhase(today, raceDate),
          monday ? new Date(monday) : undefined,
          raceDate,
          raceName
        ),
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
          phase: input.phase ?? getCurrentPhase(today, raceDate),
          raceDate,
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
  const tools = buildCoachTools(userId, now, racePlan, activities);
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
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          });
          for await (const delta of result.textStream) {
            if (delta.length === 0) continue;
            answer += delta;
            emit({ role: "assistant", content: delta });
          }
          break;
        } catch {
          // Timed out (E3) or errored. Already streamed part of this model's
          // output → cannot safely retry; otherwise fall through to the next.
          if (emitted > 0) break;
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
