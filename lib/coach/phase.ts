import { DEFAULT_RACE_DATE, type PhaseKey, type PhaseRules } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `date` to `target` (ignoring time-of-day). */
export function daysUntil(date: Date, target: Date): number {
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

/**
 * The taper window: the final stretch before the race, once the peak block is
 * over. A date this close to the race date (and not past it) is a taper.
 */
const TAPER_WINDOW_DAYS = 21;

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
const APP_TIMEZONE = "Europe/Copenhagen";

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

export function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
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
