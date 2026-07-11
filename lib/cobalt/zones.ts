// Cobalt Glass — the shared 5-zone palette.
//
// The zone scale is ordered (restitution → max), so the palette is a single
// sequential cobalt ramp, light → dark, validated for monotone lightness and
// adjacent-pair CVD separation against the silver surface.
//
// Labels are plain language — the zone *codes* ("Z1"…"Z5") are jargon the rest
// of the app deliberately avoids, and the ramp's light→dark order already
// conveys the ordering they encoded. Both the coach's weekly
// ZoneDistributionChart and the per-activity zone split read this ramp, so the
// two never drift apart.

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
