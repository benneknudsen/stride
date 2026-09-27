// Cobalt Glass — pure formatting/helpers (no React, safe in node test env).

import { HALF_MARATHON_KM } from "@/lib/coach/engine";

/** Danish month abbreviations — "17. aug", "20. sep". */
export const DA_MONTHS_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** Danish month names, unabbreviated — "Søndag 20. september". */
export const DA_MONTHS_LONG = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/** Danish weekday names, Sunday first (JS order) — "Søndag 20. september". */
export const DA_WEEKDAYS = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];

/**
 * Danish number formatting: comma as the decimal separator.
 * Values in this app are small (< 1000), so no thousands grouping is applied.
 */
export function formatDanish(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(".", ",");
}

/**
 * The calendar week a plan row lands in, as a Danish span: "17.–23. aug" inside
 * one month, "31. aug – 6. sep" across a boundary — which is also what carries
 * the year boundary (28. dec – 3. jan), since the months differ there too. No
 * year on the row: the plan window is a handful of months at most, and the year
 * would crowd out the week it is supposed to identify (issue #291).
 *
 * `weekStart` is the week's Monday, matching `getWeekPlan`'s `startDate`.
 */
export function formatWeekSpan(weekStart: Date): string {
  const start = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const startMonth = DA_MONTHS_SHORT[start.getMonth()];
  const endMonth = DA_MONTHS_SHORT[end.getMonth()];
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}.–${end.getDate()}. ${startMonth}`;
  }
  return `${start.getDate()}. ${startMonth} – ${end.getDate()}. ${endMonth}`;
}

/**
 * A distance in km, the way the plan's copy writes one: a whole distance drops the
 * decimal nobody wants to read ("14 km"), a distance with a half in it keeps it
 * ("21,1 km"), and it is always a Danish comma.
 *
 * One formatter owns that rule because the race card prints the same distance
 * twice — once as a name, once as the figure beside it — and the card only drops
 * the second when the two strings are *equal*. Two copies of the decimal rule
 * would print "14,0 km · 14 km" on one chip (#291).
 */
export function formatDistanceKm(km: number): string {
  return `${formatDanish(km, Number.isInteger(km) ? 0 : 1)} km`;
}

/** How far off a distance may be and still read as the standard race (#291). */
const DISTANCE_TOLERANCE_KM = 0.25;

/** Standard race distances and the Danish names the plan's copy uses. */
const STANDARD_DISTANCES: { km: number; label: string; inline: string }[] = [
  { km: 5, label: "5K", inline: "5K" },
  { km: 10, label: "10K", inline: "10K" },
  { km: HALF_MARATHON_KM, label: "Halvmarathon", inline: "halvmaraton" },
  { km: 42.195, label: "Marathon", inline: "marathon" },
];

/**
 * A race distance in the two forms the plan's copy needs: standalone on the race
 * card ("Halvmarathon") and mid-sentence in the headline ("under en halvmaraton"),
 * where a Danish word lowercases but a shorthand does not.
 *
 * The tolerance is what makes it usable: a runner who typed 21,0 or 21,2 km runs
 * a half marathon, and calling that "21,0 km" over and over would read like the
 * app can't tell what they entered. Anything further out is not a standard race
 * and keeps its own distance — which is then the only name it has (#291).
 */
export function raceDistanceLabel(km: number): { label: string; inline: string } {
  const standard = STANDARD_DISTANCES.find((d) => Math.abs(km - d.km) <= DISTANCE_TOLERANCE_KM);
  if (standard) return { label: standard.label, inline: standard.inline };
  const distance = formatDistanceKm(km);
  return { label: distance, inline: distance };
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
