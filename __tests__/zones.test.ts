import { describe, expect, test } from "vitest";
import {
  aggregateZones,
  DEFAULT_MAX_HR,
  formatZoneTime,
  ZONE_LIST,
  ZONES,
  zoneForHeartRate,
} from "../lib/training/zones";
import type { HrZone } from "../types/domain";

describe("zone metadata", () => {
  test("defines five zones ordered 1 → 5", () => {
    expect(ZONE_LIST.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
  });

  test("ideal distribution sums to 100%", () => {
    const total = ZONE_LIST.reduce((sum, z) => sum + z.ideal, 0);
    expect(total).toBe(100);
  });

  test("every zone carries a brand colour and key", () => {
    for (const meta of ZONE_LIST) {
      expect(meta.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(meta.key).toBe(`z${meta.zone}`);
    }
  });
});

describe("zoneForHeartRate (%max HR)", () => {
  test("classifies by % of max HR boundaries", () => {
    expect(zoneForHeartRate(0.55 * DEFAULT_MAX_HR)).toBe(1);
    expect(zoneForHeartRate(0.65 * DEFAULT_MAX_HR)).toBe(2);
    expect(zoneForHeartRate(0.75 * DEFAULT_MAX_HR)).toBe(3);
    expect(zoneForHeartRate(0.85 * DEFAULT_MAX_HR)).toBe(4);
    expect(zoneForHeartRate(0.95 * DEFAULT_MAX_HR)).toBe(5);
  });

  test("honours a custom max HR", () => {
    expect(zoneForHeartRate(170, { maxHr: 200 })).toBe(4); // 85%
    expect(zoneForHeartRate(180, { maxHr: 200 })).toBe(5); // 90% — Z5 floor
  });
});

describe("zoneForHeartRate (Karvonen %HRR)", () => {
  test("uses heart-rate reserve when resting HR is supplied", () => {
    // HRR = 200 - 50 = 150. 50 + 0.6*150 = 140 → floor of Z2.
    expect(zoneForHeartRate(140, { maxHr: 200, restingHr: 50 })).toBe(2);
    // 50 + 0.9*150 = 185 → floor of Z5.
    expect(zoneForHeartRate(185, { maxHr: 200, restingHr: 50 })).toBe(5);
  });
});

describe("aggregateZones", () => {
  test("sums per-activity hrZones buckets", () => {
    const hrZones: HrZone[] = [
      { zone: 1, min: 100, max: 120, seconds: 60 },
      { zone: 2, min: 120, max: 140, seconds: 120 },
      { zone: 5, min: 180, max: null, seconds: 20 },
    ];
    const { slices, totalSeconds } = aggregateZones([{ hrZones }]);
    expect(totalSeconds).toBe(200);
    expect(slices[0].seconds).toBe(60);
    expect(slices[1].seconds).toBe(120);
    expect(slices[1].percent).toBeCloseTo(60);
    expect(slices[4].seconds).toBe(20);
  });

  test("falls back to average HR when no hrZones present", () => {
    const { slices, totalSeconds } = aggregateZones([
      { averageHeartrate: 0.65 * DEFAULT_MAX_HR, movingTime: 600 },
    ]);
    expect(totalSeconds).toBe(600);
    expect(slices[1].seconds).toBe(600); // all moving time bucketed into Z2
  });

  test("percentages always sum to ~100 when there is data", () => {
    const { slices } = aggregateZones([
      { averageHeartrate: 130, movingTime: 600 },
      { averageHeartrate: 170, movingTime: 300 },
    ]);
    const total = slices.reduce((sum, s) => sum + s.percent, 0);
    expect(total).toBeCloseTo(100);
  });

  test("returns an empty breakdown with no usable data", () => {
    const { slices, totalSeconds } = aggregateZones([{ averageHeartrate: null, movingTime: 600 }]);
    expect(totalSeconds).toBe(0);
    expect(slices.every((s) => s.percent === 0)).toBe(true);
  });
});

describe("formatZoneTime", () => {
  test("formats minutes only under an hour", () => {
    expect(formatZoneTime(45 * 60)).toBe("45m");
  });

  test("formats hours and zero-padded minutes", () => {
    expect(formatZoneTime(2 * 3600 + 5 * 60)).toBe("2h 05m");
  });
});

describe("ZONES record", () => {
  test("is keyed by zone number", () => {
    expect(ZONES[2].name).toBe("Aerobic");
    expect(ZONES[2].color).toBe("#C6F432");
  });
});
