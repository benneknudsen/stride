// Stride — "Næste aktivitet": the next run derived from what the runner
// actually did, not from a prescribed Mon–Sun schedule.
//
// This is the counterpart to `lib/coach/recommender.ts`. The recommender starts
// from the phase's *week plan* and asks "what does today's slot say?"; this
// module starts from the runner's *last five runs* and asks "what is missing
// from the mix?". The two answer different questions, so the coach page shows
// both: the phase's next pas beside the recommendation the history argues for.
//
// The decision, in order:
//   1. Classify each of the last five runs — long (distance), hard (Z4–Z5),
//      tempo (Z3) or easy (Z1–Z2). Intensity comes from `aggregateZones`, the
//      one heart-rate→zone model the whole app shares, so a run is never
//      classified by a rule invented here.
//   2. Recovery buffer against the newest run — `EASY_MIN_RECOVERY_HOURS`
//      before any run, `MIN_RECOVERY_HOURS` before a quality session.
//   3. Readiness via `readinessFromRatio`, the same asymmetric mapping the Hjem
//      gauge and the recommender read.
//   4. Pick one: rest → tempo (mix is all easy) → long (no long run in the mix)
//      → easy. Distances come from the phase rules and paces from
//      `PACE_RANGES`, so this card can never prescribe something the plan page
//      and the recommender disagree with.
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
  ZONE2_CEILING_BPM,
} from "@/lib/coach/engine";
import { PACE_RANGES, TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
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

/** What the recommendation can prescribe — the recommender's vocabulary. */
export type NextActivityType = "rest" | "easy" | "tempo" | "long";

/** How a past run is read: its role in the mix, not its label in Strava. */
type RunKind = "easy" | "tempo" | "long" | "hard";

/** The card, plain JSON — safe to cache and to cross the server→client boundary. */
export interface NextActivityView {
  type: NextActivityType;
  /** 0 for a rest recommendation. */
  distanceKm: number;
  /** Target pace, fast → slow in min/km; "–" on a rest day. */
  paceRange: { min: string; max: string };
  /** Heart-rate ceiling in bpm, or null when there is no run to cap. */
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

/** Distance for a prescribed run, straight off the phase band. */
function distanceFor(type: Exclude<NextActivityType, "rest">, rules: PhaseRules): number {
  if (type === "long") return rules.longRunMaxKm;
  if (type === "tempo") return rules.maxDistanceKm;
  // The same mid-band easy distance the plan page's suggestions carry (#244).
  return roundHalf((rules.minDistanceKm + rules.maxDistanceKm) / 2);
}

function runCard(
  type: Exclude<NextActivityType, "rest">,
  rules: PhaseRules,
  basis: string,
  reason: string[]
): NextActivityView {
  return {
    type,
    distanceKm: distanceFor(type, rules),
    paceRange: PACE_RANGES[type],
    heartRateCap: type === "tempo" ? TEMPO_HR_CAP_BPM : ZONE2_CEILING_BPM,
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
 * The next activity to do, read off the runner's last {@link NEXT_ACTIVITY_SAMPLE}
 * runs. Deterministic: same input, same card.
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
      "Der er ingen løbeture at læse endnu — start roligt i Zone 2, så har coachen noget at bygge på.",
    ]);
  }

  const kinds = recent.map((run) => classifyRun(run, longThresholdKm));
  const countOf = (kind: RunKind) => kinds.filter((k) => k === kind).length;
  const easyCount = countOf("easy");
  const longCount = countOf("long");
  const qualityCount = countOf("tempo") + countOf("hard");
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

  // 4. What the mix is missing. All-easy without a single quality session asks
  // for tempo; no long run in the sample asks for a long run; otherwise the
  // aerobic base gets another easy tur.
  const mostlyEasy = qualityCount === 0 && easyCount * 2 > recent.length;
  let type: Exclude<NextActivityType, "rest">;
  if (mostlyEasy && rules.hasTempoSession) {
    type = "tempo";
    reason.push(
      `${easyCount} af de sidste ${recent.length} ture var rolige og ingen af dem hårde — der er plads til et kvalitetspas.`
    );
  } else if (longCount === 0) {
    type = "long";
    if (mostlyEasy) {
      reason.push(`${phase}-fasen holder alt i Zone 2, så kvalitetsarbejdet venter.`);
    }
    reason.push(
      `Ingen lang tur (${longThresholdKm}+ km) blandt de sidste ${recent.length} ture — den mangler i din uge.`
    );
  } else {
    type = "easy";
    reason.push(
      mostlyEasy
        ? `${phase}-fasen holder alt i Zone 2, så kvalitetsarbejdet venter — dagens pas bliver roligt.`
        : `Mixet i de sidste ${recent.length} ture er dækket ind — hold den aerobe base med en rolig tur.`
    );
  }

  // A quality session needs the full 48 h, not just the 24 h a run needs.
  if (type === "tempo" && gapHours < MIN_RECOVERY_HOURS) {
    type = "easy";
    reason.push(
      `Kun ${Math.round(gapHours)} timer siden sidste tur — under de ${MIN_RECOVERY_HOURS} timer et hårdt pas kræver, så det bliver en rolig tur i stedet.`
    );
  }

  if (readiness.band === "easy") {
    type = "easy";
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Hold det roligt i dag.`
    );
  } else {
    reason.push(`Din readiness er på ${readiness.pct}% — du er klar til pasget.`);
  }

  return runCard(type, rules, basis, reason);
}
