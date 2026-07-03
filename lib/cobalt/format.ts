// Cobalt Glass — pure formatting/helpers (no React, safe in node test env).

/**
 * Danish number formatting: comma as the decimal separator.
 * Values in this app are small (< 1000), so no thousands grouping is applied.
 */
export function formatDanish(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(".", ",");
}

export type IntensityTone = "cobalt" | "red" | "inactive";

/**
 * Colour tone for one bar of the 5-bar IntensityMeter.
 * Bars are 1-indexed. Active bars 1–2 read cobalt (rolig/moderat), active bars
 * 3–5 read red (hårdt). Bars above the level are inactive (rendered at 15%).
 */
export function intensityBarTone(barIndex: number, level: number): IntensityTone {
  if (barIndex > level) return "inactive";
  return barIndex <= 2 ? "cobalt" : "red";
}
