/**
 * Agent tools for the AI coach chat (`app/api/ai/chat`).
 *
 * Thin, validated adapters over the coach rule engine (the SSOT): the model
 * orchestrates, it never invents numbers. Extracted from the chat route so the
 * schemas can be unit-tested directly (issue #200).
 *
 * Provider robustness (issue #200): every non-required tool parameter is
 * `.nullish()`, not `.optional()`/`.default()`. Models routed through
 * OpenRouter — Google Gemini/Gemma in particular — routinely emit an explicit
 * `"field": null` for parameters they choose not to fill. zod `.optional()` and
 * `.default()` only tolerate `undefined`/absent and REJECT `null`, so such a
 * tool call fails validation, `streamText` reports a tool error, and the
 * candidate is treated as a dead provider. `.nullish()` accepts both `null` and
 * `undefined`; defaults are applied inside `execute` (`?? fallback`). Empty
 * parameter objects also break function-calling on some providers, so every
 * tool declares at least one property.
 */

import { tool } from "ai";
import { z } from "zod";
import {
  getCurrentPhase,
  getLocalDate,
  getWeekPlan,
  SESSION_TYPES,
  serializeValidationResult,
  validateWorkout,
  type WorkoutContext,
} from "@/lib/coach/engine";
import { buildNextActivity } from "@/lib/coach/next-activity";
import {
  type RecommendedType,
  recommendWorkout,
  weekToDateDistanceKm,
} from "@/lib/coach/recommender";
import { getPlanSuggestions } from "@/lib/cobalt/plan";
import { ensureDate } from "@/lib/db/calendar-date";
import { formatPace } from "@/lib/metrics";
import { GOALS } from "@/lib/training/goals";
import { computeSnapshot, type ProgressionActivityInput } from "@/lib/training/progression";
import type { HrZone } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;

const GOAL_KEYS = ["c25k", "marathon", "zone2", "efficient"] as const;

const isoDate = z.string().describe("ISO 8601 date string");

/** Narrow `null | undefined` to `undefined` so engine inputs never see `null`. */
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * The activity fields the progression engine reads — DB rows and demo fixtures
 * both fit. Source-agnostic by design (issue #184): the route loads activities
 * through `getDashboardActivities`, which filters by `userId` only, so the coach
 * sees every synced run regardless of provider. Both providers' mappers
 * normalise into the same columns/units, so no `source` field is needed here —
 * see the note on `AnalysisActivity` in `lib/ai/analysis.ts`.
 */
export type CoachChatActivity = {
  /** DB cuid or demo id — carried so `getRecentActivities` can emit a card that
   *  links to the activity's detail page (issue #221). */
  id: string;
  type: string;
  /** ISO string from the Neon driver, or a real Date (demo fixtures) — read it
   *  through `ensureDate`, never directly. See `ProgressionActivityInput`. */
  startDate: Date | string;
  distance: number;
  movingTime: number;
  averageHeartrate: number | null;
  hrZones?: HrZone[] | null;
};

export function buildCoachTools(
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
  // The progression snapshot is a pure function of the bound history and the
  // request's clock, so every tool in this set would compute the identical
  // object. Resolve it lazily and once (#261): a turn that never asks for
  // progression pays nothing, and a turn that asks several times pays once.
  let memoizedSnapshot: ReturnType<typeof computeSnapshot> | undefined;
  const snapshot = () => (memoizedSnapshot ??= computeSnapshot(progressionInputs, now));
  // The accumulator must hold the *normalised* date, never the raw row value:
  // the Neon driver hands `startDate` back as an ISO string (see `ensureDate`),
  // so storing `run.startDate` here parked a string in a `Date`-typed slot and
  // the next iteration's `latest.getTime()` threw
  // `TypeError: e.getTime is not a function` — a 500 on /api/ai/chat from the
  // second run onwards (4th recurrence of #190/#194/#195). The identical reduce
  // in lib/coach/dashboard.ts:243 already does it this way; the two must match.
  const latestRun = progressionInputs
    .filter((a) => /run/i.test(a.type))
    .reduce<Date | null>((latest, run) => {
      const runStart = ensureDate(run.startDate);
      if (runStart.getTime() > now.getTime()) return latest;
      return latest === null || runStart.getTime() > latest.getTime() ? runStart : latest;
    }, null);
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
  // Cross-tool coordination (#255, in chat: #258). Set by `recommendWorkout`
  // and read by `getNextActivity`, so a turn that first asks for today's pas and
  // then for an alternative never gets the same session named twice. Scoped to
  // this request's tool set — the route builds a fresh one per turn, so this is
  // per-turn state, never shared between users or requests. Left undefined when
  // the model asks for the variation on its own; then the variation is the plain
  // last-five-runs read — except on a hviledag, see `isRestDay` below (#260).
  let lastRecommendedType: RecommendedType | undefined;
  // Whether today is a hviledag in its own right (#260). A rest day is a fact
  // about today — a planned hviledag, a broken recovery buffer, a spent weekly
  // volume budget — not a de-dup preference, so the variation must honour it
  // even in a turn where the model never asked for today's pas. Computed with
  // the same defaults `buildCoachDashboard` passes, so chat and dashboard can
  // never disagree about whether today is a rest day. Deliberately narrower
  // than always seeding `todayType`: asked on its own, the variation stays the
  // plain last-five-runs read (#258), it only refuses to run through a hviledag.
  const isRestDay = (): boolean =>
    recommendWorkout(
      {
        userId,
        goal: GOALS.zone2,
        progression: snapshot(),
        lastRun: latestRun ?? new Date(now.getTime() - 2 * DAY_MS),
        footballYesterday: false,
        raceDate,
        weekToDateKm: weekToDateDistanceKm(progressionInputs, now),
      },
      now
    ).type === "rest";
  return {
    getRecentActivities: tool({
      description:
        'Hent brugerens seneste aktiviteter (op til 5) med id, type, dato, distance, pace og puls. Brug den når brugeren spørger til en tidligere tur — fx "hvad var mit seneste løb?". Kortene i svaret bygges af dette output, så id skal med.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .nullish()
          .describe("Antal seneste aktiviteter at hente (1-5, default 5)"),
      }),
      execute: async ({ limit }) => {
        const count = Math.min(5, Math.max(1, limit ?? 5));
        // Sort defensively by date desc: live rows already arrive newest-first
        // and the demo fixtures too, but a resilient tool never trusts input
        // order for "most recent". `ensureDate` normalises the Neon driver's
        // ISO strings and the fixtures' real Dates alike.
        return [...activities]
          .sort((a, b) => ensureDate(b.startDate).getTime() - ensureDate(a.startDate).getTime())
          .slice(0, count)
          .map((a) => ({
            id: a.id,
            type: a.type,
            startDate: ensureDate(a.startDate).toISOString(),
            distance: a.distance,
            movingTime: a.movingTime,
            averageHeartrate: a.averageHeartrate ?? null,
            // Readable derivations for the model's prose — the card rebuilds
            // pace from distance/movingTime, so these are stripped from the block.
            distanceKm: Math.round(a.distance / 100) / 10,
            pace: formatPace(a.movingTime > 0 ? a.distance / a.movingTime : null),
          }));
      },
    }),

    recommendWorkout: tool({
      description:
        "Anbefal brugerens næste pas som et workout card (type, distance, pace, pulsloft, sko, begrundelse, ugestrimmel). Progression og seneste løbetur læses automatisk fra brugerens egne aktiviteter.",
      inputSchema: z.object({
        goal: z
          .enum(GOAL_KEYS)
          .nullish()
          .describe("The user's training goal, when they have stated one (default zone2)"),
        footballYesterday: z
          .boolean()
          .nullish()
          .describe("Set true only if the user says they played football yesterday"),
        injuryHistory: z
          .boolean()
          .nullish()
          .describe("Set true only if the user mentions an injury history"),
        risk: z
          .enum(["low", "medium", "high"])
          .nullish()
          .describe("Optional risk read for the session, threaded to the rule engine"),
      }),
      execute: async ({ goal, footballYesterday, injuryHistory, risk }) => {
        // The recommendation is grounded in the user's real history: the
        // progression snapshot and the last-run date both come from the
        // activities the route loaded, never from model-supplied numbers.
        const recommendation = recommendWorkout(
          {
            userId,
            goal: GOALS[goal ?? "zone2"],
            progression: snapshot(),
            lastRun: latestRun ?? new Date(now.getTime() - 2 * DAY_MS),
            footballYesterday: footballYesterday ?? false,
            injuryHistory: injuryHistory ?? false,
            risk: orUndefined(risk),
            raceDate,
            // Ugens hidtidige volumen (#256) — read from the same bound
            // activities, so a loaded week softens the pas instead of stacking.
            weekToDateKm: weekToDateDistanceKm(progressionInputs, now),
          },
          now
        );
        lastRecommendedType = recommendation.type;
        return recommendation;
      },
    }),

    getNextActivity: tool({
      description:
        'Hent dagens VARIATION — det slags pas brugerens sidste fem ture mangler: en lang Zone 2-tur, en fartlek eller et intervalpas, med distance, pace-bånd og pulsloft. BRUG DEN når brugeren beder om noget andet end det sædvanlige: "giv mig en længere Zone 2-tur", "kan vi lave fartlek", "hvad med intervaller", "noget andet end det sædvanlige". Det er et alternativ til planens standardpas — ikke det samme som recommendWorkout, som svarer på "hvad skal jeg løbe i dag?".',
      // A nominal, ignored parameter: some providers reject function
      // declarations with an empty parameter object (issue #200).
      inputSchema: z.object({
        reason: z
          .string()
          .nullish()
          .describe("Valgfri kort begrundelse — påvirker ikke beregningen"),
      }),
      execute: async () =>
        // The same engine the Coach dashboard's "Næste aktivitet" card runs
        // (issue #253), grounded in the user's own last five runs —
        // `ProgressionActivityInput` is assignable to `CoachActivityInput`, so
        // the bound history feeds it unchanged. Pure and deterministic: same
        // history, same clock, same card.
        buildNextActivity({
          activities: progressionInputs,
          progression: snapshot(),
          now,
          raceDate,
          // Set when the model already asked for today's pas in this turn —
          // otherwise only to flag a hviledag, which the variation must never
          // prescribe a run through (#260).
          todayType: lastRecommendedType ?? (isRestDay() ? "rest" : undefined),
        }),
    }),

    getRunSuggestions: tool({
      description:
        "Hent ugens tre løbeforslag (let pas, kvalitetspas, langtur) for brugerens aktuelle fase — distance og pace-mål for hvert. Planen foreskriver ikke længere en fast ugedag (issue #244), så BRUG dette til at anbefale hvilket af de tre pas brugeren skal løbe i dag ud fra restitution og seneste tur. Forslagenes pace kommer fra brugerens egne aktiviteter.",
      // A nominal, ignored parameter: some providers reject function
      // declarations with an empty parameter object (issue #200).
      inputSchema: z.object({
        reason: z
          .string()
          .nullish()
          .describe("Valgfri kort begrundelse — påvirker ikke beregningen"),
      }),
      execute: async () =>
        getPlanSuggestions(
          activities.map((a) => ({
            type: a.type,
            distance: a.distance,
            movingTime: a.movingTime,
            startDate: ensureDate(a.startDate),
            averageHeartrate: a.averageHeartrate ?? null,
          })),
          now,
          raceDate,
          raceName
        ),
    }),

    getProgression: tool({
      description:
        "Beregn brugerens progressionssnapshot (hasFullWindow, pace efficiency, training load, zone 2-andel, volumen) ud fra brugerens egne synkroniserede aktiviteter.",
      // A nominal, ignored parameter: some providers reject function
      // declarations with an empty parameter object (issue #200).
      inputSchema: z.object({
        reason: z
          .string()
          .nullish()
          .describe("Valgfri kort begrundelse — påvirker ikke beregningen"),
      }),
      execute: async () => snapshot(),
    }),

    getWeekPlan: tool({
      description:
        "Ugens planlagte pas (man-søn) for en træningsfase. Udelad phase for at bruge den aktuelle fase.",
      inputSchema: z.object({
        phase: z.enum(["adapt", "burn", "sharpen", "peak"]).nullish(),
        monday: isoDate.nullish().describe("The Monday the week starts on"),
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
        plannedType: z.enum(SESSION_TYPES).nullish(),
        plannedDistanceKm: z.number().nullish(),
        plannedZone: z.number().nullish().describe("Target HR zone, 1-5"),
        shoeType: z.string().nullish().describe('e.g. "vomero" or "adios_pro"'),
        includesStrength: z.boolean().nullish(),
        lastRunDate: isoDate.nullish(),
        footballYesterday: z.boolean().nullish(),
        phase: z.enum(["adapt", "burn", "sharpen", "peak"]).nullish(),
        weeklyDistanceKm: z.number().nullish(),
        previousWeekDistanceKm: z.number().nullish(),
      }),
      execute: async (input) => {
        // Map explicitly: nullish params may arrive as `null`, but
        // WorkoutContext's optionals are `undefined`-only.
        const context: WorkoutContext = {
          plannedDate: new Date(input.plannedDate),
          plannedType: orUndefined(input.plannedType),
          plannedDistanceKm: orUndefined(input.plannedDistanceKm),
          plannedZone: orUndefined(input.plannedZone),
          shoeType: orUndefined(input.shoeType),
          includesStrength: orUndefined(input.includesStrength),
          lastRunDate: input.lastRunDate ? new Date(input.lastRunDate) : undefined,
          footballYesterday: orUndefined(input.footballYesterday),
          phase: input.phase ?? getCurrentPhase(today, raceDate),
          weeklyDistanceKm: orUndefined(input.weeklyDistanceKm),
          previousWeekDistanceKm: orUndefined(input.previousWeekDistanceKm),
          raceDate,
        };
        return serializeValidationResult(validateWorkout(context));
      },
    }),
  };
}
