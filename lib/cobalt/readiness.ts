// Cobalt Glass — the shared readiness model (issues #126/#127).
//
// One function turns the acute:chronic training-load ratio into the readiness
// number both the Hjem card and the Coach form-status card show, so the two
// pages can never disagree about the same athlete on the same day.
//
// The percentage is an *estimate* carried entirely by training load — nothing
// here measures HRV or sleep — and the UI says so.
//
// The mapping is deliberately *asymmetric* (issue #241). The acute:chronic
// ratio is an injury-risk proxy that peaks at ratio ≈ 1, but readiness is about
// *freshness*, not risk: being rested/tapered (ratio < 1) is a good thing and
// must not cost the way an overload (ratio > 1) does. So full marks span a flat
// plateau from a rested base up through a mild overload, the rested side below
// it declines only gently (fresh, maybe a touch undertrained — never a "rest"
// warning), and the steep penalty applies only on the overload side above the
// plateau, where injury risk actually climbs.
//
// Load alone cannot answer "am I recovered *right now*" (issue #259). The EWMA
// load signal is moving minutes with no intensity weighting, so a threshold
// session barely lifts the acute load and the gauge kept saying "Klar til hårdt
// pas" an hour after a hard tur. {@link readinessWithRecovery} layers the
// recommender's 48 h recovery buffer on top as a *cap* — never a raise — so the
// gauge and "Næste pas" can't contradict each other on the same day.

import { MIN_RECOVERY_HOURS } from "@/lib/coach/engine";

export type ReadinessBand = "ready" | "easy" | "rest";

export interface Readiness {
  /** Readiness percentage, clamped to 55–95 (never 0 or 100 — it's an estimate). */
  pct: number;
  band: ReadinessBand;
  /** Plain-language Danish note for the band, e.g. "Klar til hårdt pas". */
  note: string;
}

/**
 * The plain-language Danish note for each band. Exported (issue #245) so the
 * coach — feed, recommender and system prompt — speaks the same words the Hjem
 * gauge shows for the same ratio, and the two surfaces can never contradict.
 */
export const BAND_NOTES: Record<ReadinessBand, string> = {
  ready: "Klar til hårdt pas",
  easy: "Let træning anbefalet",
  rest: "Prioritér hvile i dag",
};

/** The neutral readiness shown before a chronic base exists (<4 weeks of history). */
const NO_RATIO_PCT = 72;

// Readiness percentage bounds — an estimate, so never a flat 0 or 100.
const FULL_PCT = 95;
const FLOOR_PCT = 55;

// The flat "full marks" plateau: rested down to PLATEAU_LO and mildly over the
// chronic base up to PLATEAU_HI both read fully ready. A single quality session
// nudges the acute load a little above the base (ratio ≈ 1.1–1.15) — that's
// healthy, not a warning, so it stays at full marks.
const PLATEAU_LO = 0.8;
const PLATEAU_HI = 1.15;

// Overload side (ratio > PLATEAU_HI): the steep, injury-risk penalty. Slope is
// pinned so readiness reaches the floor at ratio 2.0 (acute load double the
// base) and clamps there beyond it.
const OVERLOAD_FLOOR_RATIO = 2.0;
const OVERLOAD_SLOPE = (FULL_PCT - FLOOR_PCT) / (OVERLOAD_FLOOR_RATIO - PLATEAU_HI); // ≈ 47.06

// Rested side (ratio < PLATEAU_LO): a much gentler decline. Deep detraining
// reads a little lower (fresh but under-loaded) but, unlike an overload, never
// low enough to trip the "rest" band — freshness is not penalised like risk.
const REST_SLOPE = 25;

// Band floors — the percentages that separate rest / easy / ready. Named so the
// recovery cap below can sit exactly at the top of the easy band instead of
// repeating a magic 79.
const READY_FLOOR_PCT = 80;
const EASY_FLOOR_PCT = 68;

/**
 * The highest readiness a runner inside the recovery window may show: the top
 * of the "easy" band, one point below {@link READY_FLOOR_PCT}. High enough to
 * still read as a usable training day, low enough that the card can never say
 * "Klar til hårdt pas".
 */
export const RECOVERY_CAP_PCT = READY_FLOOR_PCT - 1;

/**
 * The band a percentage falls in — the single place the thresholds live, so the
 * cap below can never produce a pct and a band that disagree.
 */
function bandForPct(pct: number): ReadinessBand {
  return pct >= READY_FLOOR_PCT ? "ready" : pct >= EASY_FLOOR_PCT ? "easy" : "rest";
}

/**
 * Readiness from the acute:chronic load ratio (`computeSnapshot`'s
 * `trainingLoad.ratio`). Null — no chronic base yet — reads as a neutral
 * "easy" rather than a claim in either direction.
 */
export function readinessFromRatio(ratio: number | null): Readiness {
  let raw: number;
  if (ratio === null) {
    raw = NO_RATIO_PCT;
  } else if (ratio > PLATEAU_HI) {
    raw = FULL_PCT - (ratio - PLATEAU_HI) * OVERLOAD_SLOPE;
  } else if (ratio < PLATEAU_LO) {
    raw = FULL_PCT - (PLATEAU_LO - ratio) * REST_SLOPE;
  } else {
    raw = FULL_PCT;
  }
  const pct = Math.min(FULL_PCT, Math.max(FLOOR_PCT, Math.round(raw)));
  const band = bandForPct(pct);
  return { pct, band, note: BAND_NOTES[band] };
}

/**
 * The load-derived readiness, capped by how long ago the runner last went hard
 * (issue #259). Inside the recommender's {@link MIN_RECOVERY_HOURS} window the
 * result can be no better than the top of the "easy" band — "Let træning
 * anbefalet", never "Klar til hårdt pas" — because the acute:chronic ratio does
 * not know a threshold session just happened: `dailyLoad` is moving minutes
 * with no intensity weighting, so a hard 35-minute tur moves it exactly as much
 * as a rolig one.
 *
 * Strictly a **monotone downgrade**. It never raises readiness, so the #241
 * asymmetry survives untouched: an underloaded, well-rested week with no recent
 * hard effort (`hoursSinceHardEffort === null`) still reads high and "ready" —
 * freshness is not penalised, only a fresh hard effort is.
 *
 * @param base the readiness {@link readinessFromRatio} derived from load alone
 * @param hoursSinceHardEffort per `lib/training/effort.ts`; null = no hard
 *   effort in the lookback window, which leaves `base` untouched
 */
export function readinessWithRecovery(
  base: Readiness,
  hoursSinceHardEffort: number | null
): Readiness {
  if (hoursSinceHardEffort === null || hoursSinceHardEffort >= MIN_RECOVERY_HOURS) return base;
  const pct = Math.min(base.pct, RECOVERY_CAP_PCT);
  // The cap lowers the ceiling; it must not lift a "rest" read into "easy".
  const band = base.band === "rest" ? "rest" : bandForPct(pct);
  return { pct, band, note: BAND_NOTES[band] };
}

/**
 * The readiness band for a ratio, under the name the coach modules import
 * (issue #245). A thin alias of {@link readinessFromRatio} so the coach reads
 * readiness through the exact same asymmetric mapping the gauge does — one
 * source of truth for "how ready is the athlete", no divergent risk thresholds.
 */
export function getReadinessBand(ratio: number | null): Readiness {
  return readinessFromRatio(ratio);
}
