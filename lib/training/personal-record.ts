/**
 * Personal-record detection (#122) — pure derivation from activity history, no
 * DB state. A run is a PR when it beats the athlete's own prior runs, compared
 * per distance band so a fast 5k isn't drowned out by slower long runs:
 *
 * - 5k / 10k (±0.5 km) and halvmarathon (±1 km): fastest average pace wins.
 *   Distances inside a band differ slightly, so pace — not raw time — is the
 *   fair comparison.
 * - Longest run: strictly farther than every prior activity, regardless of pace.
 *
 * A band's first-ever run is not a PR — there is nothing beaten, and toasting
 * every debut would cheapen the real ones. Deliberately standalone (not inside
 * lib/cobalt/hjem.ts) so a chat-coach tool can reuse it later.
 */

/** The two fields detection reads — demo fixtures and DB rows both fit. */
export interface RecordActivityLike {
  /** Distance in meters. */
  distance: number;
  /** Moving time in seconds. */
  movingTime: number;
}

export type PersonalRecordKind = "5k" | "10k" | "half" | "longest";

const HALF_MARATHON_M = 21_097.5;

const PACE_BANDS: { kind: PersonalRecordKind; min: number; max: number }[] = [
  { kind: "5k", min: 4_500, max: 5_500 },
  { kind: "10k", min: 9_500, max: 10_500 },
  { kind: "half", min: HALF_MARATHON_M - 1_000, max: HALF_MARATHON_M + 1_000 },
];

/** Average pace in seconds per km. Callers guard against zero distance. */
function paceOf(activity: RecordActivityLike): number {
  return activity.movingTime / (activity.distance / 1000);
}

function hasPace(activity: RecordActivityLike): boolean {
  return activity.distance > 0 && activity.movingTime > 0;
}

/**
 * Which record `latest` sets against `history` (the athlete's older runs),
 * or null when it sets none. Callers pass runs only — a ride in the history
 * would make the longest-run record meaningless.
 */
export function detectPersonalRecord(
  latest: RecordActivityLike,
  history: RecordActivityLike[]
): PersonalRecordKind | null {
  if (!hasPace(latest)) return null;

  const band = PACE_BANDS.find((b) => latest.distance >= b.min && latest.distance <= b.max);
  if (band) {
    const rivals = history.filter(
      (a) => hasPace(a) && a.distance >= band.min && a.distance <= band.max
    );
    if (rivals.length > 0 && rivals.every((a) => paceOf(latest) < paceOf(a))) {
      return band.kind;
    }
  }

  if (history.length > 0 && history.every((a) => latest.distance > a.distance)) {
    return "longest";
  }

  return null;
}
