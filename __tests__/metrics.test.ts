import { describe, expect, it } from "vitest";
import { getLocalDate } from "@/lib/coach/engine";
import { demoActivities } from "@/lib/demo/data";
import { formatDuration, formatPace, getWeeklyVolume } from "@/lib/metrics";

describe("formatPace", () => {
  it("returns '--:--' for 0", () => {
    expect(formatPace(0)).toBe("--:--");
  });

  it("returns '--:--' for null", () => {
    expect(formatPace(null)).toBe("--:--");
  });

  it("returns '--:--' for negative speeds", () => {
    expect(formatPace(-5)).toBe("--:--");
  });

  it("converts 3.333 m/s to 5:00 min/km", () => {
    expect(formatPace(1000 / 300)).toBe("5:00");
  });

  it("converts 3.704 m/s to 4:30 min/km", () => {
    expect(formatPace(1000 / 270)).toBe("4:30");
  });

  it("converts 4.0 m/s to 4:10 min/km", () => {
    expect(formatPace(4.0)).toBe("4:10");
  });

  it("zero-pads the seconds component", () => {
    // 1000 / (1000/305) = 305 sec/km = 5:05
    expect(formatPace(1000 / 305)).toBe("5:05");
  });

  it("carries 60 rounded seconds up to the next minute", () => {
    // 299.7 sec/km → mins 4, secs round(59.7)=60 → carries to 5:00
    expect(formatPace(1000 / 299.7)).toBe("5:00");
  });

  it("formats very slow paces beyond ten minutes", () => {
    // 1 m/s = 1000 sec/km = 16:40
    expect(formatPace(1)).toBe("16:40");
  });

  it("formats fast sub-3-minute paces", () => {
    // 6 m/s ≈ 166.67 sec/km → 2:47
    expect(formatPace(6)).toBe("2:47");
  });

  it("treats Infinity as a zero pace string", () => {
    // 1000 / Infinity = 0 sec/km → 0:00
    expect(formatPace(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("returns '--:--' for negative infinity (<= 0 guard)", () => {
    expect(formatPace(Number.NEGATIVE_INFINITY)).toBe("--:--");
  });

  it("produces NaN components for a NaN speed (passes the > 0 guard)", () => {
    // NaN <= 0 is false, so the guard does not catch it.
    expect(formatPace(Number.NaN)).toBe("NaN:NaN");
  });
});

describe("formatDuration", () => {
  it("formats 0 as '0 min'", () => {
    expect(formatDuration(0)).toBe("0 min");
  });

  it("formats 1800 as '30 min'", () => {
    expect(formatDuration(1800)).toBe("30 min");
  });

  it("formats 3660 as '1:01h'", () => {
    expect(formatDuration(3660)).toBe("1:01h");
  });

  it("formats 5400 as '1:30h'", () => {
    expect(formatDuration(5400)).toBe("1:30h");
  });

  it("rounds 59 seconds to '1 min'", () => {
    expect(formatDuration(59)).toBe("1 min");
  });

  it("formats just under an hour (3599s rounds to 60 min → 1:00h)", () => {
    // 3599s → round(59.98) = 60 minutes, which is no longer < 60
    expect(formatDuration(3599)).toBe("1:00h");
  });

  it("formats exactly one hour as '1:00h'", () => {
    expect(formatDuration(3600)).toBe("1:00h");
  });

  it("zero-pads the minutes component of the hour form", () => {
    // 3900s = 65 min = 1:05h
    expect(formatDuration(3900)).toBe("1:05h");
  });

  it("formats multi-hour durations", () => {
    // 9000s = 150 min = 2:30h
    expect(formatDuration(9000)).toBe("2:30h");
  });

  it("handles a negative duration via rounding", () => {
    expect(formatDuration(-1800)).toBe("-30 min");
  });
});

describe("getWeeklyVolume", () => {
  // Build a date that falls safely inside the week `weeksAgo` weeks back,
  // mirroring the Monday-anchored, local-day window the function computes.
  function dateInWeek(weeksAgo: number): Date {
    const today = getLocalDate();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7) - weeksAgo * 7);
    startOfWeek.setHours(0, 0, 0, 0);
    // Thursday noon of that week — comfortably inside the [Mon, next Mon) range.
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + 3);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  it("returns 0 for an empty array", () => {
    expect(getWeeklyVolume([], 0)).toBe(0);
  });

  it("returns the distance of a single activity in the current week", () => {
    const activities = [{ startDate: dateInWeek(0), distance: 5000 }];
    expect(getWeeklyVolume(activities, 0)).toBe(5000);
  });

  it("excludes an activity from 2 weeks ago when weeksAgo=0", () => {
    const activities = [{ startDate: dateInWeek(2), distance: 8000 }];
    expect(getWeeklyVolume(activities, 0)).toBe(0);
  });

  it("includes an activity from 2 weeks ago when weeksAgo=2", () => {
    const activities = [{ startDate: dateInWeek(2), distance: 8000 }];
    expect(getWeeklyVolume(activities, 2)).toBe(8000);
  });

  it("sums multiple activities in the same week", () => {
    const activities = [
      { startDate: dateInWeek(0), distance: 5000 },
      { startDate: dateInWeek(0), distance: 3000 },
      { startDate: dateInWeek(0), distance: 2500 },
    ];
    expect(getWeeklyVolume(activities, 0)).toBe(10500);
  });

  it("only counts the requested week when activities span multiple weeks", () => {
    const activities = [
      { startDate: dateInWeek(0), distance: 5000 },
      { startDate: dateInWeek(1), distance: 9000 },
      { startDate: dateInWeek(2), distance: 7000 },
    ];
    expect(getWeeklyVolume(activities, 1)).toBe(9000);
  });

  it("includes an activity at the exact start-of-week boundary (>=)", () => {
    const today = getLocalDate();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);
    expect(getWeeklyVolume([{ startDate: startOfWeek, distance: 4000 }], 0)).toBe(4000);
  });

  it("excludes an activity at the exact end-of-week boundary (< exclusive)", () => {
    const today = getLocalDate();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    expect(getWeeklyVolume([{ startDate: endOfWeek, distance: 4000 }], 0)).toBe(0);
  });

  it("retains negative distances in the sum", () => {
    const activities = [
      { startDate: dateInWeek(0), distance: 5000 },
      { startDate: dateInWeek(0), distance: -1000 },
    ];
    expect(getWeeklyVolume(activities, 0)).toBe(4000);
  });

  it("handles a large dataset without dropping in-week activities", () => {
    const activities = Array.from({ length: 1000 }, () => ({
      startDate: dateInWeek(0),
      distance: 100,
    }));
    expect(getWeeklyVolume(activities, 0)).toBe(100000);
  });

  it("returns 0 when no activity falls in the requested future-ish offset", () => {
    const activities = [{ startDate: dateInWeek(0), distance: 5000 }];
    expect(getWeeklyVolume(activities, 5)).toBe(0);
  });
});

describe("demoActivities fixture", () => {
  it("provides 30 activities ordered newest-first", () => {
    expect(demoActivities).toHaveLength(30);
    for (let i = 1; i < demoActivities.length; i++) {
      expect(demoActivities[i - 1].startDate.getTime()).toBeGreaterThanOrEqual(
        demoActivities[i].startDate.getTime()
      );
    }
  });

  it("has positive distance and speed for every activity", () => {
    for (const a of demoActivities) {
      expect(a.distance).toBeGreaterThan(0);
      expect(a.averageSpeed).toBeGreaterThan(0);
    }
  });
});
