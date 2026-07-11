// Stride — coach rule engine. The single source of truth for the periodised
// build toward the user's target race and the constraint set the AI coach must
// respect when it proposes or validates a workout.
//
// Two halves:
//   1. Phases — four training blocks (adapt → burn → sharpen → peak) laid out
//      relative to the race date (issue #99: the date lives per user in the
//      DB; `buildPhases(raceDate)` dates the blocks for any race), each with
//      its own session volume, Zone-2 requirement and distance caps.
//   2. Constraints — independent, self-guarding rules (hard blocks, soft
//      warnings, phase guidance, safety limits) evaluated against a single
//      WorkoutContext. `validateWorkout` runs the active set and sorts the
//      results into blocking issues vs. non-blocking warnings.
//
// Everything here is pure and deterministic — the only clock reads are the
// default arguments of `getLocalDate`/`getCurrentPhase` — which keeps it
// trivially testable and safe to call from server actions or the AI tool layer.

export type PhaseKey = "adapt" | "burn" | "sharpen" | "peak" | "taper";

export interface PhaseRules {
  phase: PhaseKey;
  startDate: Date;
  endDate: Date;
  sessionsPerWeek: number;
  zone2Required: boolean;
  minDistanceKm: number;
  maxDistanceKm: number;
  hasTempoSession: boolean;
  hasLongRun: boolean;
  longRunMaxKm: number;
}

export type Severity = "hard" | "soft" | "phase" | "safety";

/**
 * A caller-supplied risk level for the planned session (issue #76 B2). Distinct
 * from the load-derived `LoadRisk` band — this is the recommender's own read on
 * how cautious to be (e.g. after football or during a taper). "high" nudges the
 * validator toward keeping the session easy.
 */
export type SessionRisk = "low" | "medium" | "high";

/**
 * The canonical session-type vocabulary the plan works in — the single source
 * of truth. Run days carry an effort (easy → race); the rest are non-run days.
 * Everything downstream derives from this one list: {@link SessionType} is its
 * element type, and the chat route's `z.enum(SESSION_TYPES)` tool schema reuses
 * the array verbatim so the model, the validator and the UI can never drift.
 * Callers that receive loosely-typed strings (AI tool output, form input)
 * should normalise/validate at the boundary — internally `normalizeType` still
 * tolerates casing.
 */
export const SESSION_TYPES = [
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
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

export interface Constraint {
  id: string;
  description: string;
  severity: Severity;
  category: string;
  evaluate(context: WorkoutContext): ValidationIssue | null;
}

export interface WorkoutContext {
  plannedDate: Date;
  plannedType?: SessionType;
  plannedDistanceKm?: number;
  plannedPace?: string;
  plannedZone?: number;
  shoeType?: string; // "vomero" | "adios_pro" | etc.
  includesStrength?: boolean;
  lastRunDate?: Date;
  lastRunDistanceKm?: number;
  footballYesterday?: boolean;
  phase: PhaseKey;
  weeklyDistanceKm?: number;
  previousWeekDistanceKm?: number;
  /** Caller's risk read for this session; "high" wants the effort kept easy. */
  risk?: SessionRisk;
  /** The user's race date (issue #99); omitted → {@link DEFAULT_RACE_DATE}. */
  raceDate?: Date;
}

export interface ValidationIssue {
  constraintId: string;
  severity: Severity;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Tunable limits ──────────────────────────────────────────────────────────

/**
 * The demo/fallback race — Silkeborg Halvmarathon, 20 Sep 2026. The engine is
 * parameterised on the race date (issue #99); this default keeps every
 * unauthenticated/demo path on the original plan. The only remaining date
 * literal — user paths thread their own `users.race_date` through instead.
 */
export const DEFAULT_RACE_DATE = new Date(2026, 8, 20); // 20 Sep 2026

/** Display name for the demo/fallback race. */
export const DEFAULT_RACE_NAME = "Silkeborg Halvmarathon";

/** Absolute Zone 2 heart-rate ceiling in bpm — a fixed number, NOT a %HRmax. */
export const ZONE2_CEILING_BPM = 155;

/**
 * Minimum recovery window before a QUALITY session (tempo/intervals/race), in
 * hours. Easy runs only need {@link EASY_MIN_RECOVERY_HOURS} — a strict 48 h
 * gap between every run would make the 5-session sharpen/peak weeks impossible
 * (at most 4 runs fit in 7 days with 48 h spacing).
 */
export const MIN_RECOVERY_HOURS = 48;

/** Minimum recovery window before an easy / long (Zone 2) run, in hours. */
export const EASY_MIN_RECOVERY_HOURS = 24;

/** Largest safe week-over-week distance growth (10%). */
export const MAX_WEEKLY_INCREASE_RATIO = 1.1;

/**
 * The taper window: the final stretch before the race, once the peak block is
 * over. A date this close to the race date (and not past it) is a taper.
 */
export const TAPER_WINDOW_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `date` to `target` (ignoring time-of-day). */
function daysUntil(date: Date, target: Date): number {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const to = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((to - from) / DAY_MS);
}

// ── Phases ──────────────────────────────────────────────────────────────────

/**
 * Fase-skabelon: [start, slut] i hele dage FØR race-dagen (issue #99). Derived
 * 1:1 from the original dated 2026 blocks (adapt 22 Jun – 5 Jul, … taper
 * 15 – 20 Sep against the 20 Sep race), so the default plan is unchanged.
 * Offsets are held fixed for any race date — a race closer than 90 days simply
 * starts mid-plan (`getCurrentPhase` picks the block containing today).
 */
const PHASE_TEMPLATE: Record<PhaseKey, { startDaysBeforeRace: number; endDaysBeforeRace: number }> =
  {
    adapt: { startDaysBeforeRace: 90, endDaysBeforeRace: 77 },
    burn: { startDaysBeforeRace: 76, endDaysBeforeRace: 49 },
    sharpen: { startDaysBeforeRace: 48, endDaysBeforeRace: 28 },
    peak: { startDaysBeforeRace: 27, endDaysBeforeRace: 6 },
    taper: { startDaysBeforeRace: 5, endDaysBeforeRace: 0 },
  };

/**
 * The date-independent half of each phase's rules. `minDistanceKm`/
 * `maxDistanceKm` bound a regular session; `longRunMaxKm` is the separate
 * weekly long-run ceiling. Sharpen/peak distances past the table's explicit
 * 6–10 km base are sensible defaults — the spec only fixes the long-run caps
 * for those blocks.
 */
const PHASE_RULES_TEMPLATE: Record<PhaseKey, Omit<PhaseRules, "startDate" | "endDate">> = {
  adapt: {
    phase: "adapt",
    sessionsPerWeek: 4,
    zone2Required: true,
    minDistanceKm: 6,
    maxDistanceKm: 8,
    hasTempoSession: false,
    hasLongRun: false,
    longRunMaxKm: 16,
  },
  burn: {
    phase: "burn",
    sessionsPerWeek: 4,
    zone2Required: true,
    minDistanceKm: 8,
    maxDistanceKm: 10,
    hasTempoSession: false,
    hasLongRun: false,
    longRunMaxKm: 16,
  },
  sharpen: {
    phase: "sharpen",
    sessionsPerWeek: 5, // 4× Z2 + 1× tempo
    zone2Required: false,
    minDistanceKm: 8,
    maxDistanceKm: 10,
    hasTempoSession: true,
    hasLongRun: false,
    longRunMaxKm: 18,
  },
  peak: {
    phase: "peak",
    sessionsPerWeek: 5, // 4× + long run
    zone2Required: false,
    minDistanceKm: 8,
    maxDistanceKm: 12,
    hasTempoSession: true, // sharpness from the sharpen block is maintained
    hasLongRun: true,
    longRunMaxKm: 18,
  },
  // The race run-in after the peak block: volume drops sharply, no hard efforts,
  // legs stay fresh for race day. Reached via `getCurrentPhase` (the 21-day
  // rule), not a dated slot in `PHASE_ORDER` — its dates only frame the rules.
  taper: {
    phase: "taper",
    sessionsPerWeek: 3, // max 3 easy run days
    zone2Required: false,
    minDistanceKm: 4,
    maxDistanceKm: 6, // ~60% of a normal peak-week session
    hasTempoSession: false, // no hard efforts in the taper
    hasLongRun: false,
    longRunMaxKm: 10,
  },
};

const PHASE_KEYS: PhaseKey[] = ["adapt", "burn", "sharpen", "peak", "taper"];
const PHASE_ORDER: PhaseKey[] = ["adapt", "burn", "sharpen", "peak"];

// Memo per race day: buildPhases is called on every request across several
// view-models, and the result only varies with the race's calendar day. Each
// entry is five small objects, and the key space is one per distinct user race
// date, so the map stays trivially small.
const phasesCache = new Map<number, Record<PhaseKey, PhaseRules>>();

/**
 * Daterede faseregler for en vilkårlig race-dato (issue #99). A pure function
 * of the race's calendar day: each phase's offsets from {@link PHASE_TEMPLATE}
 * are subtracted in whole calendar days (local-midnight arithmetic — never
 * `± N * DAY_MS` on timestamps), so leap days and DST shifts can't displace a
 * phase boundary. Time-of-day on `raceDate` is ignored.
 */
export function buildPhases(raceDate: Date): Record<PhaseKey, PhaseRules> {
  const day = dayNumber(raceDate);
  const cached = phasesCache.get(day);
  if (cached) return cached;

  const raceMidnight = new Date(raceDate.getFullYear(), raceDate.getMonth(), raceDate.getDate());
  const phases = {} as Record<PhaseKey, PhaseRules>;
  for (const key of PHASE_KEYS) {
    const template = PHASE_TEMPLATE[key];
    phases[key] = {
      ...PHASE_RULES_TEMPLATE[key],
      startDate: addDays(raceMidnight, -template.startDaysBeforeRace),
      endDate: addDays(raceMidnight, -template.endDaysBeforeRace),
    };
  }
  phasesCache.set(day, phases);
  return phases;
}

/**
 * Total plan length in whole weeks (adapt start → race day, inclusive).
 * Afløser den hardcodede `PLAN_TOTAL_WEEKS = 38` (issue #99) — the offsets are
 * fixed, so this is 13 for every race date, but deriving it keeps the template
 * the single owner of the plan's shape.
 */
export function planTotalWeeks(raceDate: Date = DEFAULT_RACE_DATE): number {
  const phases = buildPhases(raceDate);
  return Math.ceil((daysUntil(phases.adapt.startDate, phases.taper.endDate) + 1) / 7);
}

/**
 * A monotonic per-day ordering key — strictly increasing with the calendar day
 * and ignoring time-of-day. Only ever compared, never displayed, so the month
 * stays 0-indexed (the `+1` a literal YYYYMMDD would need buys nothing here).
 */
function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/** The phase rules for a key, dated against the given race. */
export function getPhaseRules(phase: PhaseKey, raceDate: Date = DEFAULT_RACE_DATE): PhaseRules {
  return buildPhases(raceDate)[phase];
}

/** The user's home timezone — the plan and the athlete both live in Denmark. */
export const APP_TIMEZONE = "Europe/Copenhagen";

/**
 * Today's calendar day in Denmark, regardless of the server's timezone (E2).
 *
 * Vercel Functions run in UTC, so a bare `new Date()` reads the *UTC* calendar
 * day — on a boundary evening that's already tomorrow for the athlete (e.g.
 * 23:30 UTC = 01:30 the next day in summer CEST), which would flip the phase,
 * the week's Monday and the day's slot one day early/late. This returns a Date
 * whose *local* Y/M/D — and therefore `getDay()` — are the Danish calendar day,
 * so every "what day is it" read agrees no matter where the code runs.
 *
 * Time-of-day is dropped (set to local midnight): callers use this only to
 * decide the day, never to measure gaps. For elapsed-time math keep the real
 * `new Date()` instant.
 */
export function getLocalDate(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(value("year"), value("month") - 1, value("day"));
}

/**
 * The training phase a date falls in. Dates before the build clamp to `adapt`.
 * After the peak block ends, the final {@link TAPER_WINDOW_DAYS} days before the
 * race are the `taper`; once the race has passed we hold at `peak`. The dated
 * blocks take precedence, so the taper only ever covers the post-peak run-in.
 */
export function getCurrentPhase(
  date: Date = getLocalDate(),
  raceDate: Date = DEFAULT_RACE_DATE
): PhaseKey {
  const phases = buildPhases(raceDate);
  const day = dayNumber(date);
  for (const key of PHASE_ORDER) {
    const phase = phases[key];
    if (day >= dayNumber(phase.startDate) && day <= dayNumber(phase.endDate)) {
      return key;
    }
  }
  if (day < dayNumber(phases.adapt.startDate)) return "adapt";
  const daysToRace = daysUntil(date, phases.taper.endDate);
  if (daysToRace >= 0 && daysToRace < TAPER_WINDOW_DAYS) return "taper";
  return "peak";
}

// ── Week plan ─────────────────────────────────────────────────────────────────

/** Monday-first weekday keys — the plan always runs Mon → Sun. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One day in a generated training week. Non-run days carry `type: "rest"`. */
export interface PlannedSession {
  weekday: Weekday;
  /** Concrete calendar date — only set when `getWeekPlan` is given a week start. */
  date?: Date;
  type: SessionType;
  /** Target HR zone for run days. */
  zone?: number;
  distanceKm?: number;
  description: string;
}

/**
 * Which weekdays carry a run, keyed by the phase's `sessionsPerWeek`. The long
 * run (when present) always lands on Sunday and the tempo mid-week on
 * Wednesday. Layouts respect the recovery windows: the Wednesday tempo gets
 * {@link MIN_RECOVERY_HOURS} clear on both sides, and easy/long days never sit
 * closer than {@link EASY_MIN_RECOVERY_HOURS} — including across the week
 * boundary (Sunday → next Monday).
 */
const WEEK_RUN_DAYS: Record<number, readonly Weekday[]> = {
  3: ["mon", "wed", "sat"],
  4: ["mon", "wed", "fri", "sun"],
  5: ["mon", "wed", "fri", "sat", "sun"],
};

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * A full Mon–Sun training week for a phase, derived from its `PhaseRules`.
 * Easy days sit at the phase's `minDistanceKm` in Zone 2; the tempo (sharpen/
 * peak) uses `maxDistanceKm`; the long run (peak) uses `longRunMaxKm`. Pass
 * `startDate` — treated as the week's Monday — to stamp a concrete date on each
 * day. `raceDate`/`raceName` anchor the taper's race week (issue #99); the
 * defaults keep demo callers on the original plan. The result never
 * self-violates the constraint set for its phase.
 */
export function getWeekPlan(
  phase: PhaseKey,
  startDate?: Date,
  raceDate: Date = DEFAULT_RACE_DATE,
  raceName: string = DEFAULT_RACE_NAME
): PlannedSession[] {
  const rules = getPhaseRules(phase, raceDate);
  if (phase === "taper") return taperWeekPlan(rules, startDate, raceDate, raceName);
  const runDays = WEEK_RUN_DAYS[rules.sessionsPerWeek] ?? WEEK_RUN_DAYS[4];
  const tempoDay: Weekday | null = rules.hasTempoSession ? "wed" : null;
  const longDay: Weekday | null = rules.hasLongRun ? "sun" : null;

  return WEEKDAYS.map((weekday, index) => {
    const date = startDate ? addDays(startDate, index) : undefined;

    if (!runDays.includes(weekday)) {
      return { weekday, date, type: "rest", description: "Hvile" };
    }
    if (weekday === longDay) {
      return {
        weekday,
        date,
        type: "long",
        zone: 2,
        distanceKm: rules.longRunMaxKm,
        description: "Lang tur (Z2)",
      };
    }
    if (weekday === tempoDay) {
      return {
        weekday,
        date,
        type: "tempo",
        zone: 4,
        distanceKm: rules.maxDistanceKm,
        description: "Tempo",
      };
    }
    return {
      weekday,
      date,
      type: "easy",
      zone: 2,
      distanceKm: rules.minDistanceKm,
      description: "Rolig Z2",
    };
  });
}

/**
 * The taper week (issue #76 B4). Two shapes:
 *   - Race week (`raceDate` falls inside the given Monday→Sunday span): 2 easy
 *     run days plus race day. A short shakeout the day before the race, a rest
 *     day the day before that, one short easy run early in the week.
 *   - Otherwise a general taper week: up to 3 easy Zone-2 days, no hard efforts,
 *     everything at the phase's reduced `minDistanceKm`.
 * Without a `startDate` (no calendar context) we can't locate the race, so we
 * fall back to the general taper shape.
 */
function taperWeekPlan(
  rules: PhaseRules,
  startDate: Date | undefined,
  raceDate: Date,
  raceName: string
): PlannedSession[] {
  const raceIndex = startDate ? daysUntil(startDate, raceDate) : -1;
  const isRaceWeek = startDate != null && raceIndex >= 0 && raceIndex <= 6;

  if (isRaceWeek && startDate) {
    return WEEKDAYS.map((weekday, index) => {
      const date = addDays(startDate, index);
      if (index === raceIndex) {
        return {
          weekday,
          date,
          type: "race",
          zone: 5,
          distanceKm: 21.1,
          description: `Race — ${raceName}`,
        };
      }
      if (index === raceIndex - 1) {
        return {
          weekday,
          date,
          type: "easy",
          zone: 2,
          distanceKm: 2,
          description: "Let udløb (2 km)",
        };
      }
      if (index === raceIndex - 2) {
        return { weekday, date, type: "rest", description: "Hvile før løb" };
      }
      if (index === 0) {
        return {
          weekday,
          date,
          type: "easy",
          zone: 2,
          distanceKm: rules.minDistanceKm,
          description: "Kort rolig tur",
        };
      }
      return { weekday, date, type: "rest", description: "Hvile" };
    });
  }

  const runDays = WEEK_RUN_DAYS[rules.sessionsPerWeek] ?? WEEK_RUN_DAYS[3];
  return WEEKDAYS.map((weekday, index) => {
    const date = startDate ? addDays(startDate, index) : undefined;
    if (!runDays.includes(weekday)) {
      return { weekday, date, type: "rest", description: "Hvile" };
    }
    return {
      weekday,
      date,
      type: "easy",
      zone: 2,
      distanceKm: rules.minDistanceKm,
      description: "Rolig Z2 (nedtrapning)",
    };
  });
}

// ── Constraint helpers ──────────────────────────────────────────────────────

/** Session types that count as fast/quality work (Adios Pro 4 territory). */
const SPEED_SESSION_TYPES = new Set(["tempo", "intervals", "race", "fartlek", "speed"]);

/** Session types that are NOT a run — leg strength on these days is fine. */
const NON_RUN_TYPES = new Set(["rest", "strength", "cross", "off", "mobility", "yoga"]);

/** Lowercased, trimmed session type — callers (AI tools, UI) vary the casing. */
function normalizeType(type?: string): string | undefined {
  return type?.trim().toLowerCase() || undefined;
}

function isSpeedSession(type?: string): boolean {
  const normalized = normalizeType(type);
  return normalized != null && SPEED_SESSION_TYPES.has(normalized);
}

/** A hard effort either by session type (speed work) or by target zone (≥ Z3). */
function isQualityEffort(context: WorkoutContext): boolean {
  return (
    isSpeedSession(context.plannedType) || (context.plannedZone != null && context.plannedZone >= 3)
  );
}

/** Whether the day carries a run (so leg strength would clash with it). */
function isRunDay(context: WorkoutContext): boolean {
  const normalized = normalizeType(context.plannedType);
  if (normalized != null) return !NON_RUN_TYPES.has(normalized);
  return context.plannedDistanceKm != null && context.plannedDistanceKm > 0;
}

/** The Adidas Adios Pro 4 — a carbon race shoe, identified loosely by name. */
function isAdiosPro(shoe?: string): boolean {
  return shoe?.toLowerCase().includes("adios") ?? false;
}

// Klemmes til ≥ 0: et ur foran serverens UTC må aldrig give et negativt gap.
function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 3_600_000);
}

// ── Constraints ─────────────────────────────────────────────────────────────

/** Puls — Zone 2 ceiling. Base phases must not exceed Zone 2. */
const zone2HrCeiling: Constraint = {
  id: "zone2-hr-ceiling",
  description: `Basefaser holder indsatsen på maks Zone 2 (≤ ${ZONE2_CEILING_BPM} bpm, absolut — ikke %HRmax).`,
  severity: "hard",
  category: "heart-rate",
  evaluate(context) {
    if (!getPhaseRules(context.phase, context.raceDate).zone2Required) return null;
    if (context.plannedZone == null || context.plannedZone <= 2) return null;
    return {
      constraintId: "zone2-hr-ceiling",
      severity: "hard",
      message: `Planlagt Zone ${context.plannedZone} overskrider Zone 2-loftet for ${context.phase}-basefasen (hold pulsen ≤ ${ZONE2_CEILING_BPM} bpm).`,
      suggestion:
        "Gå ned til en rolig Zone 2-indsats, eller flyt kvalitetsarbejdet til sharpen/peak-blokken.",
    };
  },
};

/**
 * Restitution — a recovery window before every run: 48 h before quality work,
 * 24 h before easy/long runs (a flat 48 h would outlaw the 5-session weeks).
 */
const recoveryWindow: Constraint = {
  id: "recovery-window",
  description: `Mindst ${MIN_RECOVERY_HOURS} timer før kvalitetspas, ${EASY_MIN_RECOVERY_HOURS} timer før rolige ture.`,
  severity: "hard",
  category: "recovery",
  evaluate(context) {
    if (context.lastRunDate == null) return null;
    if (!isRunDay(context)) return null;
    const required = isQualityEffort(context) ? MIN_RECOVERY_HOURS : EASY_MIN_RECOVERY_HOURS;
    const gap = hoursBetween(context.plannedDate, context.lastRunDate);
    if (gap >= required) return null;
    return {
      constraintId: "recovery-window",
      severity: "hard",
      message: `For kort tid siden hårdt pas — kun ${Math.round(gap)} timer siden sidste løbetur, under minimumet på ${required} timers restitution for dette pas.`,
      suggestion: `Udskyd turen, så der er gået mindst ${required} timer — planlæg hviledag eller let løb.`,
    };
  },
};

/** Skadesforebyggelse — never squat / leg-press on a run day. */
const noStrengthOnRunDays: Constraint = {
  id: "no-strength-on-run-days",
  description: "Aldrig squat / benpres på en løbedag.",
  severity: "hard",
  category: "injury-prevention",
  evaluate(context) {
    if (!context.includesStrength) return null;
    if (!isRunDay(context)) return null;
    return {
      constraintId: "no-strength-on-run-days",
      severity: "hard",
      message: "Benstyrke (squat / benpres) er planlagt på en løbedag.",
      suggestion: "Flyt tung bentræning til en hviledag for at beskytte løbeturen.",
    };
  },
};

/** Sko — the Adios Pro 4 is for speed / intervals only. */
const adiosProSpeedOnly: Constraint = {
  id: "adios-pro-speed-only",
  description: "Adios Pro 4 kun til fart- / intervalpas.",
  severity: "hard",
  category: "footwear",
  evaluate(context) {
    if (!isAdiosPro(context.shoeType)) return null;
    if (context.plannedType == null) return null; // type unknown — stay graceful
    if (isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "adios-pro-speed-only",
      severity: "hard",
      message: `Adios Pro 4 er en konkurrence-/fartsko — ikke til en ${context.plannedType}-tur.`,
      suggestion: "Brug andre sko — Vomero (eller en anden træningssko) til rolige og lange dage.",
    };
  },
};

/**
 * Lang tur — distance cap on long runs (16 km adapt/burn, 18 km sharpen/peak).
 *
 * The cap value is phase-derived, but business-logic §9 makes an over-distance
 * long run a HARD fail (it blocks), so the severity is "hard" rather than the
 * table's looser "phase" grouping — this is what routes it into `issues[]`.
 */
const longRunCap: Constraint = {
  id: "long-run-cap",
  description: "Lang tur begrænset til 16 km (adapt/burn) / 18 km (sharpen/peak).",
  severity: "hard",
  category: "long-run",
  evaluate(context) {
    if (normalizeType(context.plannedType) !== "long") return null;
    if (context.plannedDistanceKm == null) return null;
    const cap = getPhaseRules(context.phase, context.raceDate).longRunMaxKm;
    if (context.plannedDistanceKm <= cap) return null;
    return {
      constraintId: "long-run-cap",
      severity: "hard",
      message: `Lang tur på ${context.plannedDistanceKm} km overskrider loftet på ${cap} km for ${context.phase}-fasen.`,
      suggestion: `Kort den lange tur ned til ${cap} km eller mindre.`,
    };
  },
};

/** Fodbold — no hard running the day after a match. */
const footballRecovery: Constraint = {
  id: "football-recovery",
  description: "Ingen hård løbetræning dagen efter en fodboldkamp.",
  severity: "soft",
  category: "football",
  evaluate(context) {
    if (!context.footballYesterday) return null;
    if (!isQualityEffort(context)) return null;
    return {
      constraintId: "football-recovery",
      severity: "soft",
      message: "Hårdt pas planlagt dagen efter fodbold — benene er sandsynligvis forbelastede.",
      suggestion: "Hold det roligt (Zone 2) i dag, eller flyt kvalitetsarbejdet en dag.",
    };
  },
};

/** Basefase — keep ~90% of running in Zone 2 during the adapt/burn base. */
const basePhaseZone2: Constraint = {
  id: "base-phase-zone2",
  description: "Basefaser vil have ~90% af løbet i Zone 2 (kun adapt/burn).",
  severity: "phase",
  category: "base-phase",
  evaluate(context) {
    if (!getPhaseRules(context.phase, context.raceDate).zone2Required) return null;
    if (!isSpeedSession(context.plannedType)) return null;
    return {
      constraintId: "base-phase-zone2",
      severity: "phase",
      message: `Et ${context.plannedType}-pas ligger uden for den Zone 2-base, som ${context.phase}-fasen bygger.`,
      suggestion: "Gem kvalitetsarbejdet til sharpen-fasen; hold basen aerob.",
    };
  },
};

/** Distance-øgning — weekly volume should grow no more than 10%. */
const weeklyProgression: Constraint = {
  id: "weekly-distance-progression",
  description: "Ugentlig distance bør højst vokse 10%.",
  severity: "safety",
  category: "progression",
  evaluate(context) {
    const { weeklyDistanceKm, previousWeekDistanceKm } = context;
    if (weeklyDistanceKm == null || previousWeekDistanceKm == null || previousWeekDistanceKm <= 0) {
      return null;
    }
    if (weeklyDistanceKm <= previousWeekDistanceKm * MAX_WEEKLY_INCREASE_RATIO) return null;
    const pct = Math.round((weeklyDistanceKm / previousWeekDistanceKm - 1) * 100);
    return {
      constraintId: "weekly-distance-progression",
      severity: "safety",
      message: `Ugentlig volumen er steget ${pct}% (${previousWeekDistanceKm} → ${weeklyDistanceKm} km) — over den sikre grænse på 10%.`,
      suggestion: `Begræns denne uge til omkring ${Math.round(previousWeekDistanceKm * MAX_WEEKLY_INCREASE_RATIO)} km.`,
    };
  },
};

/**
 * Risiko — a session flagged high-risk by the caller should not also be a hard
 * effort. Soft (advisory): the recommender already downgrades on this signal,
 * but validating it here keeps the rule explicit and testable (issue #76 B2).
 */
const highRiskSession: Constraint = {
  id: "high-risk-session",
  description: "Et højrisiko-pas skal holdes roligt (ingen kvalitetsindsats).",
  severity: "soft",
  category: "risk",
  evaluate(context) {
    if (context.risk !== "high") return null;
    if (!isQualityEffort(context)) return null;
    return {
      constraintId: "high-risk-session",
      severity: "soft",
      message: "Hårdt pas planlagt på en session markeret som højrisiko.",
      suggestion: "Hold det roligt (Zone 2) i dag, eller udskyd kvalitetsarbejdet.",
    };
  },
};

/** Every constraint, in evaluation order. */
export const ALL_CONSTRAINTS: Constraint[] = [
  zone2HrCeiling,
  recoveryWindow,
  noStrengthOnRunDays,
  adiosProSpeedOnly,
  longRunCap,
  footballRecovery,
  basePhaseZone2,
  weeklyProgression,
  highRiskSession,
];

/** Constraints that only apply while a base phase requires Zone 2. */
const ZONE2_ONLY_CONSTRAINTS = new Set(["zone2-hr-ceiling", "base-phase-zone2"]);

/** The constraints in force for a phase (drops the Zone-2 base rules outside adapt/burn). */
export function getActiveConstraints(phase: PhaseKey): Constraint[] {
  const zone2Required = getPhaseRules(phase).zone2Required;
  return ALL_CONSTRAINTS.filter((c) => (ZONE2_ONLY_CONSTRAINTS.has(c.id) ? zone2Required : true));
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Run every active constraint against the context. Hard violations land in
 * `issues` (and flip `valid` false); soft / phase / safety violations land in
 * `warnings` (advisory only).
 */
export function validateWorkout(context: WorkoutContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const constraint of getActiveConstraints(context.phase)) {
    const issue = constraint.evaluate(context);
    if (!issue) continue;
    if (issue.severity === "hard") issues.push(issue);
    else warnings.push(issue);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

// ── Client serialization ──────────────────────────────────────────────────────

/**
 * A `ValidationResult` flattened for the client boundary (plain JSON, no
 * `undefined` gaps across a server→client prop) with a ready-to-render
 * `summary` line added.
 */
export interface SerializedValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  /** One-line Danish headline for the UI. */
  summary: string;
}

function summarizeValidation(result: ValidationResult): string {
  if (!result.valid) {
    const n = result.issues.length;
    return `${n} blokerende ${n === 1 ? "problem" : "problemer"}`;
  }
  if (result.warnings.length > 0) {
    const n = result.warnings.length;
    return `Godkendt med ${n} ${n === 1 ? "advarsel" : "advarsler"}`;
  }
  return "Godkendt";
}

/** Flatten a `ValidationResult` into a plain, JSON-safe shape for the client. */
export function serializeValidationResult(result: ValidationResult): SerializedValidationResult {
  return {
    valid: result.valid,
    issues: result.issues,
    warnings: result.warnings,
    summary: summarizeValidation(result),
  };
}
