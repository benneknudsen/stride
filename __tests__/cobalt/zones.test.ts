import { describe, expect, it } from "vitest";
import { zoneBadgeForHeartRate, zoneBadgeText } from "@/lib/cobalt/zones";
import { DEFAULT_MAX_HR } from "@/lib/training/zones";

describe("zoneBadgeText", () => {
  it("prefixes the zone number before the plain-language label", () => {
    expect(zoneBadgeText({ level: 3, label: "Moderat tempo" })).toBe("Zone 3 · Moderat tempo");
  });

  it("uses the same format for hard (red) zones", () => {
    expect(zoneBadgeText({ level: 5, label: "Meget hårdt" })).toBe("Zone 5 · Meget hårdt");
  });

  it("matches a badge derived from a heart rate", () => {
    const badge = zoneBadgeForHeartRate(0.95 * DEFAULT_MAX_HR);
    expect(zoneBadgeText(badge)).toBe(`Zone ${badge.level} · ${badge.label}`);
  });
});
