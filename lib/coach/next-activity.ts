// Stride — "Næste aktivitet": the *variation* the runner's last five runs are
// missing, not a second opinion on today's session (issue #253).
//
// This is the counterpart to `lib/coach/recommender.ts`, and the two answer
// deliberately different questions:
//   • "Næste pas" (recommender) — the *right* run for today: the phase's week
//     plan, filtered through the recovery buffer and readiness. Plan-grounded.
//   • "Næste aktivitet" (here) — a *different kind* of session than the plan's
//     standard easy/tempo/long: a long Zone 2 tur, a fartlek or intervals,
//     picked from what the last five runs do not contain. Variation.
// Before #253 both cards prescribed from the same easy/tempo/long vocabulary
// and read as duplicates ("er det kort eller lang tur?"); the variety vocabulary
// is what keeps them distinguishable.
//
// The decision, in order:
//   1. Classify each of the last five runs — long (distance), hard (Z4–Z5),
//      tempo (Z3) or easy (Z1–Z2). Intensity comes from `aggregateZones`, the
//      one heart-rate→zone model the whole app shares, so a run is never
//      classified by a rule invented here.
//   2. Recovery buffer against the newest run — `EASY_MIN_RECOVERY_HOURS`
//      before any run, `MIN_RECOVERY_HOURS` before a fast session.
//   3. Readiness via `readinessFromRatio`, the same asymmetric mapping the Hjem
//      gauge and the recommender read: rest → hvile, easy → a rolig tur.
//   4. What the mix lacks: no long run → the long Zone 2 tur; no quality at all
//      → fartlek; tempo but no real speed → intervals; everything covered →
//      a rolig restitutionstur. Distances come from the phase rules and paces
//      from `PACE_RANGES`, so this card can never prescribe something the plan
//      page and the recommender disagree with.
//
// Pure and deterministic: the clock is a parameter, so the same input always
// yields the same card.

// The activity type is imported type-only, so this never becomes a runtime
// import cycle with dashboard.ts (which imports `buildNextActivity` as a value).
import type { CoachActivityInput } from "@/lib/coach/dashboard";
import {
  EASY_MIN_RECOVERY_HOURS,
  getCurrentPhase,
  getLocalDate,
  getPhaseRules,
  MIN_RECOVERY_HOURS,
  type PhaseRules,
  type SessionType,
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";
import { PACE_RANGES, TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
import { formatDanish } from "@/lib/cobalt/format";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import type { ProgressionSnapshot } from "@/lib/training/progression";
import { aggregateZones, type ZoneNumber } from "@/lib/training/zones";

/** How many recent runs the recommendation reads. */
export const NEXT_ACTIVITY_SAMPLE = 5;

/**
 * A run counts as "long" from this share of the phase's long-run ceiling
 * (`longRunMaxKm`) upward — 13 km in the base phases, 14,5 km in sharpen/peak,
 * 8 km in the taper. Phase-relative rather than a fixed number so the bar moves
 * with what the block actually asks for.
 */
export const LONG_RUN_MIN_FACTOR = 0.8;

const HOUR_MS = 3_600_000;

/**
 * What the variation can prescribe. Derived from the engine's {@link SessionType}
 * vocabulary (the recommender does the same with `RecommendedType`), so the two
 * cards name sessions with the same words even though they never pick the same
 * way: `fartlek`/`intervals` are exactly the types the phase plan's standard
 * easy/tempo/long week never schedules.
 */
export type NextActivityType = Extract<
  SessionType,
  "rest" | "easy" | "long" | "fartlek" | "intervals"
>;

/** Everything but `rest` — the types that actually prescribe a run. */
type RunType = Exclude<NextActivityType, "rest">;

/** How a past run is read: its role in the mix, not its label in Strava. */
type RunKind = "easy" | "tempo" | "long" | "hard";

type PaceRange = { min: string; max: string };

/**
 * Pace bands for the two sessions the plan's own vocabulary has no entry for.
 * Both derive from {@link PACE_RANGES} so "what is tempo pace" still has exactly
 * one owner: a fartlek's surges hit the tempo band's fast end while its floats
 * sit at easy pace, and interval reps run a step quicker than tempo.
 */
export const VARIETY_PACE_RANGES = {
  fartlek: { min: PACE_RANGES.tempo.min, max: PACE_RANGES.easy.max },
  intervals: { min: "4:20", max: PACE_RANGES.tempo.min },
} satisfies Record<"fartlek" | "intervals", PaceRange>;

/** The card, plain JSON — safe to cache and to cross the server→client boundary. */
export interface NextActivityView {
  type: NextActivityType;
  /** 0 for a rest recommendation. */
  distanceKm: number;
  /** Target pace, fast → slow in min/km; "–" on a rest day. */
  paceRange: PaceRange;
  /** Heart-rate ceiling in bpm; null on a rest day and for intervals (whose
   *  reps are meant to reach Zone 4–5, so a ceiling would misdescribe them). */
  heartRateCap: number | null;
  /** Danish one-liner over the sampled mix ("Sidste 5 ture: 4 rolige · …"). */
  basis: string;
  reason: string[];
}

export interface NextActivityInput {
  /** The runner's history; the newest {@link NEXT_ACTIVITY_SAMPLE} runs are read. */
  activities: CoachActivityInput[];
  /** Current progression snapshot — its training load drives readiness. */
  progression: ProgressionSnapshot;
  now: Date;
  /** The user's race date (issue #99); omitted → the engine's demo default. */
  raceDate?: Date;
}

/** Running activity types: "Run", "TrailRun", "VirtualRun", … */
function isRun(activity: CoachActivityInput): boolean {
  return /run/i.test(activity.type);
}

/** Prescribed distances sit on a half-km grid — "7,5 km", never "7,25 km". */
function roundHalf(km: number): number {
  return Math.round(km * 2) / 2;
}

/**
 * The zone a single run spent most of its time in, via the shared aggregator —
 * Strava's `hrZones` buckets when present, otherwise the zone its average heart
 * rate implies. Null when the run carries no heart-rate data at all.
 */
function dominantZone(run: CoachActivityInput): ZoneNumber | null {
  const { slices, totalSeconds } = aggregateZones([run]);
  if (totalSeconds === 0) return null;
  return slices.reduce((top, slice) => (slice.seconds > top.seconds ? slice : top)).meta.zone;
}

/**
 * A past run's role in the mix. Distance decides first: a 20 km run is the
 * week's long run however hard the heart rate ran. Below the long-run bar the
 * dominant zone decides — Z4–Z5 is a hard session, Z3 a tempo, the rest easy.
 * A run without heart rate reads as easy rather than inventing an intensity.
 */
function classifyRun(run: CoachActivityInput, longThresholdKm: number): RunKind {
  if (run.distance / 1000 >= longThresholdKm) return "long";
  const zone = dominantZone(run);
  if (zone === null) return "easy";
  if (zone >= 4) return "hard";
  if (zone === 3) return "tempo";
  return "easy";
}

/**
 * Distance for a prescribed run, straight off the phase band. The long tur takes
 * the phase's long-run ceiling; a fartlek is a normal-length run with surges, so
 * it takes the band's top; intervals sit mid-band because the reps — not the
 * kilometres — carry the session.
 */
function distanceFor(type: RunType, rules: PhaseRules): number {
  if (type === "long") return rules.longRunMaxKm;
  if (type === "fartlek") return rules.maxDistanceKm;
  // The same mid-band easy distance the plan page's suggestions carry (#244).
  return roundHalf((rules.minDistanceKm + rules.maxDistanceKm) / 2);
}

function paceFor(type: RunType): PaceRange {
  if (type === "fartlek") return VARIETY_PACE_RANGES.fartlek;
  if (type === "intervals") return VARIETY_PACE_RANGES.intervals;
  return PACE_RANGES[type];
}

function heartRateCapFor(type: RunType): number | null {
  if (type === "intervals") return null;
  if (type === "fartlek") return TEMPO_HR_CAP_BPM;
  return ZONE2_CEILING_BPM;
}

function runCard(
  type: RunType,
  rules: PhaseRules,
  basis: string,
  reason: string[]
): NextActivityView {
  return {
    type,
    distanceKm: distanceFor(type, rules),
    paceRange: paceFor(type),
    heartRateCap: heartRateCapFor(type),
    basis,
    reason,
  };
}

function restCard(basis: string, reason: string[]): NextActivityView {
  return {
    type: "rest",
    distanceKm: 0,
    paceRange: { min: "–", max: "–" },
    heartRateCap: null,
    basis,
    reason,
  };
}

/**
 * The variation to put next to today's planned pas, read off the runner's last
 * {@link NEXT_ACTIVITY_SAMPLE} runs. Deterministic: same input, same card.
 */
export function buildNextActivity({
  activities,
  progression,
  now,
  raceDate,
}: NextActivityInput): NextActivityView {
  // E2: which phase we're in must read the athlete's Danish calendar day, not
  // the server's UTC one — same rule the recommender follows.
  const phase = getCurrentPhase(getLocalDate(now), raceDate);
  const rules = getPhaseRules(phase, raceDate);
  const longThresholdKm = roundHalf(rules.longRunMaxKm * LONG_RUN_MIN_FACTOR);

  const recent = activities
    .filter(isRun)
    .filter((run) => ensureDate(run.startDate).getTime() <= now.getTime())
    .sort((a, b) => ensureDate(b.startDate).getTime() - ensureDate(a.startDate).getTime())
    .slice(0, NEXT_ACTIVITY_SAMPLE);

  if (recent.length === 0) {
    return runCard("easy", rules, "Ingen registrerede ture endnu", [
      "Der er ingen løbeture at læse endnu — start roligt i Zone 2, så har coachen noget at variere ud fra.",
    ]);
  }

  const kinds = recent.map((run) => classifyRun(run, longThresholdKm));
  const countOf = (kind: RunKind) => kinds.filter((k) => k === kind).length;
  const easyCount = countOf("easy");
  const longCount = countOf("long");
  const hardCount = countOf("hard");
  const qualityCount = countOf("tempo") + hardCount;
  const basis = `Sidste ${recent.length} ture: ${easyCount} rolige · ${qualityCount} kvalitet · ${longCount} lange`;

  const reason: string[] = [];

  // 2. Recovery buffer against the newest run. Under 24 h no run is safe, so
  // this wins over everything the mix might argue for.
  const gapHours = Math.max(
    0,
    (now.getTime() - ensureDate(recent[0].startDate).getTime()) / HOUR_MS
  );
  if (gapHours < EASY_MIN_RECOVERY_HOURS) {
    reason.push(
      `Kun ${Math.round(gapHours)} timer siden sidste tur — under de ${EASY_MIN_RECOVERY_HOURS} timers restitution en ny løbetur kræver.`
    );
    return restCard(basis, reason);
  }

  // 3. Readiness — the same asymmetric mapping the Hjem gauge shows, so the two
  // surfaces can never contradict each other for the same load ratio.
  const readiness = readinessFromRatio(progression.trainingLoad.ratio);
  if (readiness.band === "rest") {
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Kroppen beder om restitution i dag.`
    );
    return restCard(basis, reason);
  }
  if (readiness.band === "easy") {
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Hold det roligt: variationen i dag er en rolig restitutionstur, ikke et fartpas.`
    );
    return runCard("easy", rules, basis, reason);
  }

  // 4. What the mix is missing — the variation, never a copy of the phase's
  // standard session. A fast variation needs the full 48 h (not the 24 h a Zone
  // 2 run needs) and a phase that allows intensity at all; the long Zone 2 tur
  // is exempt, since it is aerobic work every phase can take.
  const intensityPhase = rules.hasTempoSession;
  const bufferClear = gapHours >= MIN_RECOVERY_HOURS;
  // Both fast variations need something the mix lacks: all-aerobic asks for a
  // fartlek, tempo-without-speed asks for intervals.
  const wantsIntensity = qualityCount === 0 || hardCount === 0;

  let type: RunType;
  if (longCount === 0) {
    type = "long";
    reason.push(
      `Ingen lang tur (${formatDanish(longThresholdKm)}+ km) blandt de sidste ${recent.length} ture — en lang rolig Zone 2-tur er den variation din uge mangler.`
    );
  } else if (qualityCount === 0 && intensityPhase && bufferClear) {
    type = "fartlek";
    reason.push(
      `Alle ${recent.length} seneste ture var rolige og jævne — en fartlek bryder rytmen med fartspring uden at være et hårdt intervalpas.`
    );
  } else if (hardCount === 0 && intensityPhase && bufferClear) {
    type = "intervals";
    reason.push(
      `Der er tempo i mixet, men ingen rigtige fartpas — korte intervaller i Zone 4–5 rammer den fart, planens standardpas ikke gør.`
    );
  } else {
    type = "easy";
    if (wantsIntensity && !intensityPhase) {
      reason.push(
        `${phase}-fasen holder alt i Zone 2, så fartarbejdet venter — variationen bliver en rolig tur.`
      );
    } else if (wantsIntensity && !bufferClear) {
      reason.push(
        `Kun ${Math.round(gapHours)} timer siden sidste tur — under de ${MIN_RECOVERY_HOURS} timer et fartpas kræver, så variationen bliver en rolig tur.`
      );
    } else {
      reason.push(
        `De sidste ${recent.length} ture dækker både fart og distance — så variationen i dag er en rolig restitutionstur.`
      );
    }
  }

  reason.push(`Din readiness er på ${readiness.pct}% — du er klar til variationen.`);

  return runCard(type, rules, basis, reason);
}
