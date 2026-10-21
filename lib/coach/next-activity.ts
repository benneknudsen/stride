// Stride — "Næste aktivitet": the *variation* the runner's recent runs are
// missing, not a second opinion on today's session (issue #253).
//
// This is the counterpart to `lib/coach/recommender.ts`, and the two answer
// deliberately different questions:
//   • "Næste pas" (recommender) — the *right* run for today: the phase's week
//     plan, filtered through the recovery buffer and readiness. Plan-grounded.
//   • "Næste aktivitet" (here) — a *different kind* of session than the plan's
//     standard easy/tempo/long: a long Zone 2 tur, a fartlek or intervals,
//     picked from what the recent runs do not contain. Variation.
// Before #253 both cards prescribed from the same easy/tempo/long vocabulary
// and read as duplicates ("er det kort eller lang tur?"); the variety vocabulary
// is what keeps them distinguishable.
//
// The decision, in order:
//   1. Classify runs — long (distance), hard (Z4–Z5), tempo (Z3) or easy
//      (Z1–Z2). Intensity comes from `aggregateZones`, the one heart-rate→zone
//      model the whole app shares, so a run is never classified by a rule
//      invented here. The five newest runs describe both the basis line and the
//      mix; the 28-day window is read only for the long-run hole (#333).
//   2. Recovery buffer against the newest run — `EASY_MIN_RECOVERY_HOURS`
//      before any run at all, and the full `MIN_RECOVERY_HOURS` before the one
//      session that really is hard: intervals. A fartlek is fartspring inside an
//      otherwise easy run, not a hard interval pas, so it clears on the same
//      24 h as a Zone 2 tur (issue #254).
//   3. Today's "Næste pas" itself, when it is hvile (#260). The plan rests for
//      reasons this card cannot see — a planned hviledag in the phase week, the
//      recommender's own recovery buffer, or a week whose volume budget is
//      already spent (#256) — and any run prescribed beside it reads as a
//      contradiction ("Næste pas: Hvile" next to "Næste aktivitet: Intervalpas,
//      9 km"). So the variation rests too; hvile on both cards is the one
//      overlap the de-dup in step 6 has always allowed.
//   4. Readiness via `readinessFromRatio`, the same asymmetric mapping the Hjem
//      gauge and the recommender read: rest → hvile, easy → a rolig tur.
//   4b. State shape (#333): the same shared `dayShapeGate` the recommender reads.
//      A pause, or a hard/long last run inside the 48 h residue window, caps
//      today at a rolig tur before the mix can argue for intervals — and the
//      de-dup cannot switch it back.
//   5. What the mix lacks: no long run → the long Zone 2 tur; no quality at all
//      → fartlek; tempo but no real speed → intervals; everything covered →
//      fartlek again, since a rolig tur is what "Næste pas" already prescribes
//      and would collapse the two cards back into duplicates (#254). Distances
//      come from the phase rules and paces from `PACE_RANGES`, so this card can
//      never prescribe something the plan page and the recommender disagree with.
//   Fast variations are available in every phase (#254). A base block like burn
//   has no tempo session, so there the fartlek/interval is prescribed at reduced
//   intensity — surges and reps capped at the tempo band, never Zone 4–5.
//   6. Cross-card coordination (#255): the mix alone can land on exactly the
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
import {
  classifyRun,
  dayShapeGate,
  dayShapeReason,
  longRunThresholdKm,
  type RunKind,
} from "@/lib/coach/run-character";
import { formatDanish } from "@/lib/cobalt/format";
import { readinessFromRatio } from "@/lib/cobalt/readiness";
import { ensureDate } from "@/lib/db/calendar-date";
import type { ProgressionSnapshot } from "@/lib/training/progression";

/** How many recent runs the recommendation reads. */
const NEXT_ACTIVITY_SAMPLE = 5;

const HOUR_MS = 3_600_000;

/** How far back the missing-long check looks (issue #333). */
const HOLE_WINDOW_DAYS = 28;
const HOLE_WINDOW_MS = HOLE_WINDOW_DAYS * 24 * HOUR_MS;

/**
 * What the variation can prescribe. Derived from the engine's {@link SessionType}
 * vocabulary (the recommender does the same with `RecommendedType`), so the two
 * cards name sessions with the same words even though they never pick the same
 * way: `fartlek`/`intervals` are exactly the types the phase plan's standard
 * easy/tempo/long week never schedules.
 */
type NextActivityType = Extract<SessionType, "rest" | "easy" | "long" | "fartlek" | "intervals">;

/** Everything but `rest` — the types that actually prescribe a run. */
type RunType = Exclude<NextActivityType, "rest">;

/** The two fast sessions — the ones a base phase gets in a dæmpet variant (#254). */
type VarietyType = Extract<RunType, "fartlek" | "intervals">;

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
  /** Danish one-liner over the sampled mix — five runs, or the 28-day window when it cut runs. */
  basis: string;
  reason: string[];
}

interface NextActivityInput {
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
  /**
   * Today's "Næste pas" distance, when the caller knows it (#333 repair). On a
   * gate day both cards prescribe a rolig tur; sharing the distance keeps AC6's
   * "de samme tal" true instead of the variation inventing its own mid-band km.
   */
  todayDistanceKm?: number;
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

/** What the recent mix says about which fast session is the right one. */
interface MixContext {
  /** The long-run hole, read over the 28-day window. */
  longCount: number;
  /** Hard (Z4–Z5) runs among the five newest, the mix the card varies from. */
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
 * Safety-forced cards never reach here: a broken recovery buffer, a plan that
 * says hvile (#260) or a readiness band asking for hvile/rolig is answered
 * before the mix is ever read, and there agreeing with the plan is the right
 * call, not a duplicate to design away. `todayType === "rest"` therefore never
 * arrives — and could not collide anyway, since `natural` is always a run.
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
  reduced = false,
  distanceKm?: number
): NextActivityView {
  return {
    type,
    distanceKm: distanceKm ?? distanceFor(type, rules),
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
  todayDistanceKm,
}: NextActivityInput): NextActivityView {
  // E2: which phase we're in must read the athlete's Danish calendar day, not
  // the server's UTC one — same rule the recommender follows.
  const today = getLocalDate(now);
  const phase = getCurrentPhase(today, raceDate);
  const rules = getPhaseRules(phase, raceDate);
  const longThresholdKm = longRunThresholdKm(rules);
  // #330: the same load-risk band the recommender and the gauge read. High risk
  // is a rest day; elevated risk is a caution that only softens fast work.
  const loadRisk = progression.trainingLoad.risk;
  const highRiskReason =
    loadRisk === "high"
      ? "Høj skadesrisiko — variationen venter, til belastningen er faldet."
      : null;

  const eligible = activities
    .filter(isRun)
    .filter((run) => ensureDate(run.startDate).getTime() <= now.getTime())
    .sort((a, b) => ensureDate(b.startDate).getTime() - ensureDate(a.startDate).getTime());
  const recent = eligible.slice(0, NEXT_ACTIVITY_SAMPLE);

  if (recent.length === 0) {
    return runCard("easy", rules, "Ingen registrerede ture endnu", [
      "Der er ingen løbeture at læse endnu — start roligt i Zone 2, så har coachen noget at variere ud fra.",
    ]);
  }

  // #333: the missing-long check reaches further back than the five runs the
  // basis describes. 28 days is the same horizon the zone chart reads, so a
  // long run from three weeks ago still counts as covered.
  const windowRuns = eligible.filter(
    (run) => ensureDate(run.startDate).getTime() >= now.getTime() - HOLE_WINDOW_MS
  );
  const windowCut = windowRuns.length < eligible.length;

  // Classify each run in the window once. The five newest runs decide both the
  // basis line and the hard/quality mix (#333 repair R6): the wider window is
  // only for the long-run hole, so one monthly hard run cannot keep the card
  // from ever suggesting intervals again.
  const recentKinds = recent.map((run) => classifyRun(run, longThresholdKm));
  const windowKinds = windowRuns.map((run) => classifyRun(run, longThresholdKm));
  const basisKinds = windowCut ? windowKinds : recentKinds;
  const countOf = (list: RunKind[], kind: RunKind) => list.filter((k) => k === kind).length;
  const basisEasy = countOf(basisKinds, "easy");
  const basisLong = countOf(basisKinds, "long");
  const basisQuality = countOf(basisKinds, "tempo") + countOf(basisKinds, "hard");
  const basis = windowCut
    ? `Seneste ${HOLE_WINDOW_DAYS} dage: ${basisEasy} rolige · ${basisQuality} kvalitet · ${basisLong} lange`
    : `Sidste ${recent.length} ture: ${basisEasy} rolige · ${basisQuality} kvalitet · ${basisLong} lange`;

  const longCount = countOf(windowKinds, "long");
  const hardCount = countOf(recentKinds, "hard");
  const qualityCount = countOf(recentKinds, "tempo") + hardCount;

  const reason: string[] = [];

  // 2. Recovery buffer against the newest run. Under 24 h no run is safe, so
  // this wins over everything the mix might argue for. When that run happened
  // earlier today, the card says so (issue #273) — a generic "kun N timer" note
  // is the unexplained hviledag the issue reports. Same local-calendar read the
  // phase above uses.
  const gapHours = Math.max(
    0,
    (now.getTime() - ensureDate(recent[0].startDate).getTime()) / HOUR_MS
  );
  if (gapHours < EASY_MIN_RECOVERY_HOURS) {
    const ranToday = getLocalDate(ensureDate(recent[0].startDate)).getTime() === today.getTime();
    if (highRiskReason) reason.push(highRiskReason);
    reason.push(
      ranToday
        ? `Du har løbet i dag — hviledag for restitution. Kun ${Math.round(
            gapHours
          )} timer siden turen, under de ${EASY_MIN_RECOVERY_HOURS} timers restitution en ny løbetur kræver.`
        : `Kun ${Math.round(gapHours)} timer siden sidste tur — under de ${EASY_MIN_RECOVERY_HOURS} timers restitution en ny løbetur kræver.`
    );
    return restCard(basis, reason);
  }

  // 3. Today's pas is hvile (#260). The recommender rests for reasons the mix
  // below cannot see — a deliberate taper day, its own recovery buffer, high
  // load risk, or a week whose planned volume is already covered (#256/#330) —
  // and the variation used to prescribe straight through them, putting
  // "Intervalpas, 9 km" next to "Næste pas: Hvile". This must outrank the
  // readiness bands below, not follow them: the easy band still prescribes a
  // rolig tur, and a run of any length beside a hviledag is the contradiction
  // being removed. The copy names both possible sources (#332): a rest slot is
  // only a preference now, so the hvile may come from a safety gate, not the plan.
  if (todayType === "rest") {
    reason.push(
      'Dagens "Næste pas" er hvile — så variationen venter. Coachen har lagt hvile ind efter planen eller efter en sikkerhedsgrænse; det er bevidst, ikke et hul i planen.'
    );
    return restCard(basis, reason);
  }

  // 3b. Load risk (#330). This is the same guard the recommender applies, read
  // from the same band: high risk means no run at all, even if today's "Næste
  // pas" were a run. Elevated is handled after the mix, where only the fast
  // variations are softened.
  if (highRiskReason) {
    reason.push(highRiskReason);
    return restCard(basis, reason);
  }

  // 4. Readiness — the same asymmetric mapping the Hjem gauge shows, so the two
  // surfaces can never contradict each other for the same load ratio.
  const readiness = readinessFromRatio(progression.trainingLoad.ratio);
  if (readiness.band === "rest") {
    reason.push(
      `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Kroppen beder om restitution i dag.`
    );
    return restCard(basis, reason);
  }

  // 4b. State-based day shape (#333): the same shared gate the recommender
  // reads. A pause, or a hard/long last run inside the 48 h residue window, caps
  // today at a rolig tur — the variation must not answer with intervals or a
  // long run on the same day the pas says the effort cannot stack. When the gate
  // fires, the mix and the de-dup below are skipped: the gate's answer is the
  // day's answer, not one opinion the cross-card coordination may switch back to
  // something harder.
  //
  // When the pas already landed on easy, its distance is today's distance too
  // (#333 repair R6): two cards prescribing the same rolig tur must not quote
  // 8 km and 9 km for it. Without a pas in the input, the mid-band distance
  // still stands.
  const easyDistanceKm = todayType === "easy" ? todayDistanceKm : undefined;
  const easyReadinessReason = `Din readiness er på ${readiness.pct}% — ${readiness.note.toLowerCase()}. Hold det roligt: variationen i dag er en rolig restitutionstur, ikke et fartpas.`;
  const gate = dayShapeGate({
    character: recentKinds[0],
    gapHours,
  });
  if (gate) {
    reason.push(
      readiness.band === "easy"
        ? easyReadinessReason
        : `Din readiness er på ${readiness.pct}% — du er klar til en rolig tur i dag.`
    );
    reason.push(dayShapeReason(gate, gapHours));
    return runCard("easy", rules, basis, reason, false, easyDistanceKm);
  }

  if (readiness.band === "easy") {
    reason.push(easyReadinessReason);
    return runCard("easy", rules, basis, reason, false, easyDistanceKm);
  }

  // 5. What the mix is missing — the variation, never a copy of the phase's
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
      `Ingen lang tur (${formatDanish(longThresholdKm)}+ km) blandt de seneste ${HOLE_WINDOW_DAYS} dage — en lang rolig Zone 2-tur er den variation din uge mangler.`
    );
  } else if (qualityCount === 0) {
    type = "fartlek";
    reason.push(
      `Alle de seneste ${recent.length} ture var rolige og jævne — en fartlek bryder rytmen med fartspring uden at være et hårdt intervalpas.`
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
      `De seneste ${recent.length} ture dækker både fart og distance — så variationen i dag er en fartlek, der holder benene kvikke uden at lægge et nyt hårdt pas oven i.`
    );
  }

  // 6. Cross-card coordination (#255) — the mix has spoken, but if the plan
  // already prescribes exactly that session today, the variation steps aside so
  // the two cards name two different pas.
  const coordinated = avoidPlanDuplicate(type, todayType, mix);
  if (coordinated !== type) {
    reason.push(
      `Men dagens "Næste pas" er allerede ${TYPE_LABELS[type]}, så variationen bliver ${TYPE_LABELS[coordinated]} i stedet — de to kort skal ikke sige det samme.`
    );
    type = coordinated;
  }

  // Elevated load risk is a caution, not a stop (#330): the fast variations are
  // softened to a rolig tur, while a long Zone 2 run — already aerobic — stays.
  const softenedByRisk = loadRisk === "elevated" && (type === "fartlek" || type === "intervals");
  if (softenedByRisk) {
    type = "easy";
    reason.push("Belastningen er forhøjet — fartpasset bliver en rolig Zone 2-tur i dag.");
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

  reason.push(
    softenedByRisk
      ? `Din readiness er på ${readiness.pct}% — men belastningen er forhøjet, så variationen holdes rolig i dag.`
      : `Din readiness er på ${readiness.pct}% — du er klar til variationen.`
  );

  return runCard(type, rules, basis, reason, reduced);
}
