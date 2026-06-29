import { describe, expect, it } from "vitest";
import { demoActivities } from "@/lib/demo/data";
import {
  formatDistance,
  formatDuration,
  formatPace,
  getPaceDistribution,
  getSummaryStats,
  getWeekLabel,
  getWeeklyVolume,
  getWeeklyVolumeSeries,
  PACE_BUCKETS,
} from "@/lib/metrics";

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

describe("formatDistance", () => {
  it("formats 0 as '0.0'", () => {
    expect(formatDistance(0)).toBe("0.0");
  });

  it("formats 5000 as '5.0'", () => {
    expect(formatDistance(5000)).toBe("5.0");
  });

  it("formats 42195 as '42.2'", () => {
    expect(formatDistance(42195)).toBe("42.2");
  });

  it("rounds to one decimal place (449 m → 0.4)", () => {
    expect(formatDistance(449)).toBe("0.4");
  });

  it("rounds half up (450 m → 0.5)", () => {
    expect(formatDistance(450)).toBe("0.5");
  });

  it("formats negative distances", () => {
    expect(formatDistance(-5000)).toBe("-5.0");
  });

  it("formats very large ultra distances", () => {
    expect(formatDistance(160934)).toBe("160.9");
  });

  it("renders NaN as 'NaN'", () => {
    expect(formatDistance(Number.NaN)).toBe("NaN");
  });

  it("renders Infinity as 'Infinity'", () => {
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("getWeeklyVolume", () => {
  // Build a date that falls safely inside the week `weeksAgo` weeks back,
  // mirroring the Sunday-anchored window the function computes.
  function dateInWeek(weeksAgo: number): Date {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
    startOfWeek.setHours(0, 0, 0, 0);
    // Wednesday noon of that week — comfortably inside the [Sun, next Sun) range.
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
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    expect(getWeeklyVolume([{ startDate: startOfWeek, distance: 4000 }], 0)).toBe(4000);
  });

  it("excludes an activity at the exact end-of-week boundary (< exclusive)", () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
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

describe("getWeekLabel", () => {
  it("labels the current week", () => {
    expect(getWeekLabel(0)).toBe("This Week");
  });

  it("labels the previous week", () => {
    expect(getWeekLabel(1)).toBe("Last Week");
  });

  it("formats older weeks as a localized month/day", () => {
    const label = getWeekLabel(4);
    const expected = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 4 * 7);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    })();
    expect(label).toBe(expected);
  });

  it("returns a non-empty string for arbitrary large offsets", () => {
    expect(getWeekLabel(52).length).toBeGreaterThan(0);
  });
});

describe("getPaceDistribution", () => {
  it("returns one entry per bucket with zero counts for no activities", () => {
    const result = getPaceDistribution([]);
    expect(result).toHaveLength(5);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it("drops activities with null or zero speed", () => {
    const result = getPaceDistribution([{ averageSpeed: null }, { averageSpeed: 0 }]);
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });

  it("buckets a 5:00/km run (3.33 m/s) into the 5:00-5:30 band", () => {
    const result = getPaceDistribution([{ averageSpeed: 1000 / 300 }]);
    const bucket = result.find((b) => b.pace === "5:00-5:30");
    expect(bucket?.count).toBe(1);
  });

  it("places a bucket boundary pace in the upper bucket (>= min, < max)", () => {
    // exactly 300 sec/km falls into 5:00-5:30, not 4:30-5:00
    const result = getPaceDistribution([{ averageSpeed: 1000 / 300 }]);
    expect(result.find((b) => b.pace === "4:30-5:00")?.count).toBe(0);
    expect(result.find((b) => b.pace === "5:00-5:30")?.count).toBe(1);
  });

  it("buckets a sub-4:30 fast run into the '< 4:30' band", () => {
    // 250 sec/km
    const result = getPaceDistribution([{ averageSpeed: 1000 / 250 }]);
    expect(result.find((b) => b.pace === "< 4:30")?.count).toBe(1);
  });

  it("buckets a slow run into the open-ended '> 6:00' band", () => {
    // 400 sec/km
    const result = getPaceDistribution([{ averageSpeed: 1000 / 400 }]);
    expect(result.find((b) => b.pace === "> 6:00")?.count).toBe(1);
  });

  it("drops negative speeds along with null and zero", () => {
    const result = getPaceDistribution([
      { averageSpeed: -3 },
      { averageSpeed: null },
      { averageSpeed: 0 },
    ]);
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });

  it("distributes a large mixed dataset across buckets", () => {
    const fast = Array.from({ length: 100 }, () => ({ averageSpeed: 1000 / 250 }));
    const slow = Array.from({ length: 50 }, () => ({ averageSpeed: 1000 / 400 }));
    const result = getPaceDistribution([...fast, ...slow]);
    expect(result.find((b) => b.pace === "< 4:30")?.count).toBe(100);
    expect(result.find((b) => b.pace === "> 6:00")?.count).toBe(50);
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(150);
  });

  it("exposes five contiguous PACE_BUCKETS ending at infinity", () => {
    expect(PACE_BUCKETS).toHaveLength(5);
    expect(PACE_BUCKETS[0].min).toBe(0);
    expect(PACE_BUCKETS[PACE_BUCKETS.length - 1].max).toBe(Number.POSITIVE_INFINITY);
    for (let i = 1; i < PACE_BUCKETS.length; i++) {
      expect(PACE_BUCKETS[i].min).toBe(PACE_BUCKETS[i - 1].max);
    }
  });
});

describe("getWeeklyVolumeSeries", () => {
  function dateInWeek(weeksAgo: number): Date {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() - weeksAgo * 7);
    startOfWeek.setHours(0, 0, 0, 0);
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + 3);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  it("returns the requested number of weeks, oldest first", () => {
    const series = getWeeklyVolumeSeries([], 12);
    expect(series).toHaveLength(12);
    expect(series[series.length - 1]?.week).toBe("This Week");
    expect(series[series.length - 2]?.week).toBe("Last Week");
  });

  it("defaults to 12 weeks when no count is given", () => {
    expect(getWeeklyVolumeSeries([])).toHaveLength(12);
  });

  it("returns an empty series when weeks is 0", () => {
    expect(getWeeklyVolumeSeries([], 0)).toEqual([]);
  });

  it("returns a single 'This Week' entry when weeks is 1", () => {
    const series = getWeeklyVolumeSeries([], 1);
    expect(series).toHaveLength(1);
    expect(series[0]?.week).toBe("This Week");
  });

  it("converts meters to kilometres rounded to one decimal", () => {
    // 5450 m in the current week → 5.5 km after round-to-one-decimal
    const series = getWeeklyVolumeSeries([{ startDate: dateInWeek(0), distance: 5450 }], 1);
    expect(series[0]?.km).toBe(5.5);
  });

  it("reports zero kilometres for weeks with no activities", () => {
    const series = getWeeklyVolumeSeries([], 4);
    expect(series.every((s) => s.km === 0)).toBe(true);
  });

  it("places each week's distance in the correct slot", () => {
    const activities = [
      { startDate: dateInWeek(0), distance: 10000 },
      { startDate: dateInWeek(2), distance: 20000 },
    ];
    const series = getWeeklyVolumeSeries(activities, 3);
    // oldest first: index 0 = 2 weeks ago, index 2 = this week
    expect(series[0]?.km).toBe(20);
    expect(series[1]?.km).toBe(0);
    expect(series[2]?.km).toBe(10);
  });
});

describe("getSummaryStats", () => {
  it("averages pace over the seven most recent activities", () => {
    const stats = getSummaryStats([
      { startDate: new Date(), distance: 1000, movingTime: 300 },
      { startDate: new Date(), distance: 1000, movingTime: 300 },
    ]);
    // 2000 m over 600 s = 3.333 m/s
    expect(stats.avgPace).toBeCloseTo(2000 / 600);
    expect(stats.totalDistance).toBe(2000);
  });

  it("reports null pace when there is no moving time", () => {
    const stats = getSummaryStats([]);
    expect(stats.avgPace).toBeNull();
    expect(stats.totalDistance).toBe(0);
    expect(stats.thisWeekVolume).toBe(0);
  });

  it("averages pace over only the seven most recent activities", () => {
    // 10 activities, but only the first 7 (newest) feed avgPace.
    const activities = Array.from({ length: 10 }, () => ({
      startDate: new Date(),
      distance: 1000,
      movingTime: 300,
    }));
    const stats = getSummaryStats(activities);
    // 7 * 1000 m / (7 * 300 s) = 3.333 m/s
    expect(stats.avgPace).toBeCloseTo(7000 / 2100);
    // but totalDistance spans all 10
    expect(stats.totalDistance).toBe(10000);
  });

  it("returns null pace when the recent runs have zero moving time", () => {
    const stats = getSummaryStats([{ startDate: new Date(), distance: 1000, movingTime: 0 }]);
    expect(stats.avgPace).toBeNull();
    expect(stats.totalDistance).toBe(1000);
  });

  it("sums totalDistance across every activity regardless of week", () => {
    const old = new Date();
    old.setDate(old.getDate() - 200);
    const stats = getSummaryStats([
      { startDate: new Date(), distance: 3000, movingTime: 900 },
      { startDate: old, distance: 7000, movingTime: 2100 },
    ]);
    expect(stats.totalDistance).toBe(10000);
  });

  it("handles a single activity for the seven-run pace window", () => {
    const stats = getSummaryStats([{ startDate: new Date(), distance: 2000, movingTime: 600 }]);
    expect(stats.avgPace).toBeCloseTo(2000 / 600);
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
