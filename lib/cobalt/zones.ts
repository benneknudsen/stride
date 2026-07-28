// Cobalt Glass — the shared 5-zone palette and badge labels.
//
// The zone scale is ordered (restitution → max), so the palette is a single
// sequential cobalt ramp, light → dark, validated for monotone lightness and
// adjacent-pair CVD separation against the silver surface.
//
// Labels are plain language — the internal zone *codes* ("Z1"…"Z5") stay jargon
// the rest of the app avoids. The zone *number* (1–5), however, is now surfaced
// alongside the label everywhere a badge appears via {@link zoneBadgeText}
// ("Zone 3 · Moderat tempo"), so the ordering the ramp's light→dark palette
// encodes is spelled out too. Both the coach's weekly ZoneDistributionChart and
// the per-activity zone split read this ramp, so the two never drift apart.
//
// The zone *number* itself is never derived here: lib/training/zones.ts is the
// single heart-rate→zone source (issue #129), and this file only maps its
// ZoneNumber onto the Danish badge language the Cobalt pages speak.

import {
  zoneForHeartRate as trainingZoneForHeartRate,
  type ZoneHrConfig,
  type ZoneNumber,
} from "@/lib/training/zones";

export type ZoneKey = "z1" | "z2" | "z3" | "z4" | "z5";

export interface ZoneRampStep {
  key: ZoneKey;
  label: string;
  color: string;
}

export const ZONE_RAMP: ZoneRampStep[] = [
  { key: "z1", label: "Restitution", color: "#ccd3f5" },
  { key: "z2", label: "Aerob", color: "#9aa6ec" },
  { key: "z3", label: "Tempo", color: "#6577e0" },
  { key: "z4", label: "Tærskel", color: "#3c4ed0" },
  { key: "z5", label: "Max", color: "#131f96" },
];

/** A zone as the activity badges wear it: IntensityMeter level + plain Danish. */
export interface ZoneBadge {
  /** IntensityMeter level 1–5 — the ZoneNumber itself. */
  level: ZoneNumber;
  /** Plain-language Danish zone (never "Z3"). */
  label: string;
  tone: "cobalt" | "red";
}

/** Danish badge label + tone per zone. Zones 4–5 are the only "hard" (red) ones. */
const ZONE_BADGES: Record<ZoneNumber, Omit<ZoneBadge, "level">> = {
  1: { label: "Restitution", tone: "cobalt" },
  2: { label: "Rolig snak-fart", tone: "cobalt" },
  3: { label: "Moderat tempo", tone: "cobalt" },
  4: { label: "Hårdt tempo", tone: "red" },
  5: { label: "Meget hårdt", tone: "red" },
};

/**
 * The badge for a heart rate: the zone comes from lib/training/zones.ts (the
 * one model the per-activity zone split also uses — issue #129), the language
 * from {@link ZONE_BADGES}. Same `config` as the split, so badge and split
 * centre can never disagree about the same pulse.
 */
export function zoneBadgeForHeartRate(bpm: number, config: ZoneHrConfig = {}): ZoneBadge {
  const level = trainingZoneForHeartRate(bpm, config);
  return { level, ...ZONE_BADGES[level] };
}

/**
 * The one badge string every zone chip wears: "Zone 3 · Moderat tempo". Keeps
 * the number + label format identical across the activity list, home cards and
 * the detail header so no surface shows the label alone.
 */
export function zoneBadgeText(zone: { level: number; label: string }): string {
  return `Zone ${zone.level} · ${zone.label}`;
}
