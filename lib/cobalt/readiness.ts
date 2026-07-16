// Cobalt Glass — the shared readiness model (issues #126/#127).
//
// One function turns the acute:chronic training-load ratio into the readiness
// number both the Hjem card and the Coach form-status card show, so the two
// pages can never disagree about the same athlete on the same day.
//
// The percentage is an *estimate* carried entirely by training load — nothing
// here measures HRV or sleep — and the UI says so. Readiness peaks when the
// acute load sits right on the chronic base (ratio ≈ 1) and falls off as the
// athlete spikes above it or detrains below it.

export type ReadinessBand = "ready" | "easy" | "rest";

export interface Readiness {
  /** Readiness percentage, clamped to 55–95 (never 0 or 100 — it's an estimate). */
  pct: number;
  band: ReadinessBand;
  /** Plain-language Danish note for the band, e.g. "Klar til hårdt pas". */
  note: string;
}

const BAND_NOTES: Record<ReadinessBand, string> = {
  ready: "Klar til hårdt pas",
  easy: "Let træning anbefalet",
  rest: "Prioritér hvile i dag",
};

/** The neutral readiness shown before a chronic base exists (<4 weeks of history). */
const NO_RATIO_PCT = 72;

/**
 * Readiness from the acute:chronic load ratio (`computeSnapshot`'s
 * `trainingLoad.ratio`). Null — no chronic base yet — reads as a neutral
 * "easy" rather than a claim in either direction.
 */
export function readinessFromRatio(ratio: number | null): Readiness {
  const pct =
    ratio === null
      ? NO_RATIO_PCT
      : Math.min(95, Math.max(55, Math.round(95 - Math.abs(ratio - 1) * 45)));
  const band: ReadinessBand = pct >= 80 ? "ready" : pct >= 68 ? "easy" : "rest";
  return { pct, band, note: BAND_NOTES[band] };
}
