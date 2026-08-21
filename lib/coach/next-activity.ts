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
//      before any run at all, and the full `MIN_RECOVERY_HOURS` before the one
//      session that really is hard: intervals. A fartlek is fartspring inside an
//      otherwise easy run, not a hard interval pas, so it clears on the same
//      24 h as a Zone 2 tur (issue #254).
//   3. Readiness via `readinessFromRatio`, the same asymmetric mapping the Hjem
//      gauge and the recommender read: rest → hvile, easy → a rolig tur.
//   4. What the mix lacks: no long run → the long Zone 2 tur; no quality at all
//      → fartlek; tempo but no real speed → intervals; everything covered →
//      fartlek again, since a rolig tur is what "Næste pas" already prescribes
//      and would collapse the two cards back into duplicates (#254). Distances
//      come from the phase rules and paces from `PACE_RANGES`, so this card can
//      never prescribe something the plan page and the recommender disagree with.
//   Fast variations are available in every phase (#254). A base block like burn
//   has no tempo session, so there the fartlek/interval is prescribed at reduced
//   intensity — surges and reps capped at the tempo band, never Zone 4–5.
//   5. Cross-card coordination (#255): the mix alone can land on exactly the
//      session today's "Næste pas" already prescribes — both cards saying "lang
//      tur" is the duplicate #253 set out to remove. With `todayType` passed in,
//      the variation steps aside; see `avoidPlanDuplicate`.
//
// Pure and deterministic: the clock and today's planned pas are parameters, so
// the same input always yields the same card.

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
import { PACE_RANGES, type RecommendedType, TEMPO_HR_CAP_BPM } from "@/lib/coach/recommender";
import { formatDanish } from "@/lib/cobalt/format";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import { dominantZone, isHardEffort } from "@/lib/training/effort";
import type { ProgressionSnapshot } from "@/lib/training/progression";

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

/** The two fast sessions — the ones a base phase gets in a dæmpet variant (#254). */
type VarietyType = Extract<RunType, "fartlek" | "intervals">;

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
} satisfies Record<VarietyType, PaceRange>;

/**
 * The same two sessions, dæmpet — what a Zone 2 base block (no `hasTempoSession`)
 * gets instead of nothing at all (#254). Both bands stop at the tempo band's fast
 * end, so neither the surges nor the reps reach into Zone 4–5: a base-phase
 * fartlek surges to tempo's slow end, and its intervals run the tempo band flat.
 */
export const REDUCED_VARIETY_PACE_RANGES = {
  fartlek: { min: PACE_RANGES.tempo.max, max: PACE_RANGES.easy.max },
  intervals: { min: PACE_RANGES.tempo.min, max: PACE_RANGES.tempo.max },
} satisfies Record<VarietyType, PaceRange>;

/** The card, plain JSON — safe to cache and to cross the server→client boundary. */
export interface NextActivityView {
  type: NextActivityType;
  /** 0 for a rest recommendation. */
  distanceKm: number;
  /** Target pace, fast → slow in min/km; "–" on a rest day. */
  paceRange: PaceRange;
  /** Heart-rate ceiling in bpm; null on a rest day and for full-intensity
   *  intervals (whose reps are meant to reach Zone 4–5, so a ceiling would
   *  misdescribe them). A base phase's dæmpet intervals do carry one (#254). */
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
  /**
   * Today's "Næste pas" — the type `recommendWorkout` landed on (#255). The
   * variation steps aside when the plan already prescribes that session, so the
   * two cards never read as duplicates. Optional: omitted, the card is the plain
   * last-five-runs read it was before the coordination existed.
   */
  todayType?: RecommendedType;
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
 * A past run's role in the mix. Distance decides first: a 20 km run is the
 * week's long run however hard the heart rate ran. Below the long-run bar the
 * intensity decides — Z4–Z5 is a hard session (the shared {@link isHardEffort},
 * which the readiness cap reads too, so the two can never disagree about what
 * "hard" means), Z3 a tempo, the rest easy. A run without heart rate reads as
 * easy rather than inventing an intensity.
 */
function classifyRun(run: CoachActivityInput, longThresholdKm: number): RunKind {
  if (run.distance / 1000 >= longThresholdKm) return "long";
  if (isHardEffort(run)) return "hard";
  return dominantZone(run) === 3 ? "tempo" : "easy";
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

/** `reduced` — a Zone 2 base phase, where the fast work is prescribed dæmpet. */
function paceFor(type: RunType, reduced: boolean): PaceRange {
  if (type === "fartlek" || type === "intervals") {
    return reduced ? REDUCED_VARIETY_PACE_RANGES[type] : VARIETY_PACE_RANGES[type];
  }
  return PACE_RANGES[type];
}

function heartRateCapFor(type: RunType, reduced: boolean): number | null {
  // Only full-intensity reps are meant to reach Zone 4–5; the dæmpet variant is
  // capped at tempo precisely so it cannot (#254).
  if (type === "intervals") return reduced ? TEMPO_HR_CAP_BPM : null;
  if (type === "fartlek") return TEMPO_HR_CAP_BPM;
  return ZONE2_CEILING_BPM;
}

/** How each variation is named in the Danish de-dup note. */
const TYPE_LABELS: Record<RunType, string> = {
  easy: "en rolig tur",
  long: "en lang Zone 2-tur",
  fartlek: "en fartlek",
  intervals: "et intervalpas",
};

/** What the last five runs say about which fast session is the right one. */
interface MixContext {
  longCount: number;
  hardCount: number;
  /** Whether the full 48 h an intervalpas needs have passed (#254). */
  intervalBufferClear: boolean;
}

/**
 * The fast variation that is safe right now: intervals when the mix holds no
 * real speed and the 48 h buffer is clear, otherwise the fartlek that clears on
 * the 24 h already checked (#254).
 */
function fastVariation(mix: MixContext): VarietyType {
  return mix.hardCount === 0 && mix.intervalBufferClear ? "intervals" : "fartlek";
}

/**
 * Cross-card coordination (#255). "Næste pas" and "Næste aktivitet" share only
 * two words — `easy` and `long`: the plan never schedules a fartlek or an
 * intervalpas, and the variation never prescribes a tempo. So those two are the
 * only collisions possible, and when one happens the variation yields:
 *   • plan = lang tur → the fast variation the mix allows, since the week's
 *     distance is already covered by the plan itself.
 *   • plan = rolig tur → the long Zone 2-tur if the mix lacks one, otherwise the
 *     fast variation.
 * Safety-forced cards never reach here: a broken recovery buffer or a readiness
 * band asking for hvile/rolig is answered before the mix is ever read, and there
 * agreeing with the plan is the right call, not a duplicate to design away.
 */
export function avoidPlanDuplicate(
  natural: RunType,
  todayType: RecommendedType | undefined,
  mix: MixContext
): RunType {
  if (natural !== todayType) return natural;
  if (natural === "long") return fastVariation(mix);
  if (natural === "easy") return mix.longCount === 0 ? "long" : fastVariation(mix);
  return natural;
}

function runCard(
  type: RunType,
  rules: PhaseRules,
  basis: string,
  reason: string[],
  reduced = false
): NextActivityView {
  return {
    type,
    distanceKm: distanceFor(type, rules),
    paceRange: paceFor(type, reduced),
    heartRateCap: heartRateCapFor(type, reduced),
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
  todayType,
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
  // standard session. Only intervals still need the full 48 h; a fartlek is
  // fartspring inside an easy run and clears on the 24 h already checked above
  // (#254), as does the long Zone 2 tur.
  const intervalBufferClear = gapHours >= MIN_RECOVERY_HOURS;
  // A Zone 2 base block still gets the variation — just dæmpet, capped at tempo.
  const reduced = !rules.hasTempoSession;

  let type: RunType;
  const mix: MixContext = { longCount, hardCount, intervalBufferClear };
  if (longCount === 0) {
    type = "long";
    reason.push(
      `Ingen lang tur (${formatDanish(longThresholdKm)}+ km) blandt de sidste ${recent.length} ture — en lang rolig Zone 2-tur er den variation din uge mangler.`
    );
  } else if (qualityCount === 0) {
    type = "fartlek";
    reason.push(
      `Alle ${recent.length} seneste ture var rolige og jævne — en fartlek bryder rytmen med fartspring uden at være et hårdt intervalpas.`
    );
  } else if (hardCount === 0 && intervalBufferClear) {
    type = "intervals";
    reason.push(
      `Der er tempo i mixet, men ingen rigtige fartpas — korte intervaller rammer den fart, planens standardpas ikke gør.`
    );
  } else if (hardCount === 0) {
    type = "fartlek";
    reason.push(
      `Der mangler rigtige fartpas, men der er kun gået ${Math.round(gapHours)} timer siden sidste tur — under de ${MIN_RECOVERY_HOURS} timer et intervalpas kræver, så variationen bliver en fartlek i stedet.`
    );
  } else {
    type = "fartlek";
    reason.push(
      `De sidste ${recent.length} ture dækker både fart og distance — så variationen i dag er en fartlek, der holder benene kvikke uden at lægge et nyt hårdt pas oven i.`
    );
  }

  // 5. Cross-card coordination (#255) — the mix has spoken, but if the plan
  // already prescribes exactly that session today, the variation steps aside so
  // the two cards name two different pas.
  const coordinated = avoidPlanDuplicate(type, todayType, mix);
  if (coordinated !== type) {
    reason.push(
      `Men dagens "Næste pas" er allerede ${TYPE_LABELS[type]}, så variationen bliver ${TYPE_LABELS[coordinated]} i stedet — de to kort skal ikke sige det samme.`
    );
    type = coordinated;
  }

  // The dæmpet note belongs on the fast variations only — the long Zone 2 tur is
  // aerobic work every phase already prescribes at full værdi.
  if (reduced && (type === "fartlek" || type === "intervals")) {
    reason.push(
      type === "fartlek"
        ? `${phase}-fasen er en Zone 2-fase, så fartspringene køres roligere — op i tempobåndet, uden fulde Zone 4–5-blokke.`
        : `${phase}-fasen er en Zone 2-fase, så intervallerne køres roligere — reps i tempobåndet med puls under ${TEMPO_HR_CAP_BPM}, uden fulde Zone 4–5-blokke.`
    );
  }

  reason.push(`Din readiness er på ${readiness.pct}% — du er klar til variationen.`);

  return runCard(type, rules, basis, reason, reduced);
}
