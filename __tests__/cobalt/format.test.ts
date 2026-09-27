import { describe, expect, it } from "vitest";
import { HALF_MARATHON_KM } from "@/lib/coach/engine";
import {
  formatDanish,
  formatDistanceKm,
  formatWeekSpan,
  intensityBarTone,
  raceDistanceLabel,
} from "@/lib/cobalt/format";

describe("formatDanish", () => {
  it("uses a comma as the decimal separator", () => {
    expect(formatDanish(23.2, 1)).toBe("23,2");
  });

  it("defaults to one decimal", () => {
    expect(formatDanish(81.2)).toBe("81,2");
  });

  it("respects an explicit decimal count", () => {
    expect(formatDanish(8, 0)).toBe("8");
    expect(formatDanish(7.05, 2)).toBe("7,05");
  });

  it("rounds to the requested precision", () => {
    expect(formatDanish(5.16, 1)).toBe("5,2");
  });
});

describe("formatWeekSpan", () => {
  // A Monday, like the plan's rows. "Kommende uger" shows which calendar week a
  // row lands in, so the span has to read the way a Danish calendar reads
  // (issue #291) — and a row can straddle a month or a year.
  const MONDAY = new Date(2026, 7, 17); // 17 Aug 2026, a Monday

  it("names the month once when the week sits inside it", () => {
    expect(formatWeekSpan(MONDAY)).toBe("17.–23. aug");
  });

  it("writes single-digit days without padding", () => {
    // 3–9 Aug 2026 — neither day reaches two digits.
    expect(formatWeekSpan(new Date(2026, 7, 3))).toBe("3.–9. aug");
  });

  it("names both months when the week straddles a month boundary", () => {
    expect(formatWeekSpan(new Date(2026, 7, 31))).toBe("31. aug – 6. sep");
  });

  it("reads correctly across the year boundary", () => {
    expect(formatWeekSpan(new Date(2026, 11, 28))).toBe("28. dec – 3. jan");
  });

  it("ignores the time of day it is handed", () => {
    expect(formatWeekSpan(new Date(2026, 7, 17, 23, 45))).toBe("17.–23. aug");
  });
});

describe("raceDistanceLabel", () => {
  it("names the standard distances", () => {
    expect(raceDistanceLabel(5).label).toBe("5K");
    expect(raceDistanceLabel(10).label).toBe("10K");
    expect(raceDistanceLabel(21.0975).label).toBe("Halvmarathon");
    expect(raceDistanceLabel(42.195).label).toBe("Marathon");
  });

  it("lowercases the Danish word for mid-sentence use", () => {
    expect(raceDistanceLabel(21.0975).inline).toBe("halvmaraton");
    expect(raceDistanceLabel(21.0975).label).toBe("Halvmarathon");
    // A shorthand distance carries no Danish word, so it reads the same inline.
    expect(raceDistanceLabel(10).inline).toBe("10K");
  });

  it("absorbs a distance a step off the standard one", () => {
    // A runner who typed 21,0 or 21,2 km still runs a half marathon.
    expect(raceDistanceLabel(21).label).toBe("Halvmarathon");
    expect(raceDistanceLabel(21.2).label).toBe("Halvmarathon");
  });

  it("stops naming a distance once it leaves the tolerance", () => {
    expect(raceDistanceLabel(21.35).label).toBe("21,4 km");
    expect(raceDistanceLabel(21.5).label).toBe("21,5 km");
  });

  it("falls back to the raw distance when there's no standard one", () => {
    expect(raceDistanceLabel(12.5)).toEqual({ label: "12,5 km", inline: "12,5 km" });
  });

  it("falls back to a whole-km distance without the decimal nobody wants to read", () => {
    // A 14 km race has no preset name, so this string is *both* the card's name
    // and — through the same formatter — the figure printed beside it. Formatting
    // the two differently would put "14,0 km · 14 km" on one chip (#291).
    expect(raceDistanceLabel(14)).toEqual({ label: "14 km", inline: "14 km" });
  });
});

describe("formatDistanceKm", () => {
  // One formatter owns the decimal rule, so the two halves of the race card's
  // distance chip can't disagree about how a distance prints (#291).
  it("drops the decimal on a whole distance", () => {
    expect(formatDistanceKm(14)).toBe("14 km");
    expect(formatDistanceKm(10)).toBe("10 km");
  });

  it("keeps the decimal when the distance has one, comma-separated", () => {
    expect(formatDistanceKm(12.5)).toBe("12,5 km");
    expect(formatDistanceKm(HALF_MARATHON_KM)).toBe("21,1 km");
  });
});

describe("intensityBarTone", () => {
  it("colours active bars 1–2 cobalt", () => {
    expect(intensityBarTone(1, 4)).toBe("cobalt");
    expect(intensityBarTone(2, 4)).toBe("cobalt");
  });

  it("colours active bars 3–5 red", () => {
    expect(intensityBarTone(3, 4)).toBe("red");
    expect(intensityBarTone(4, 4)).toBe("red");
    expect(intensityBarTone(5, 5)).toBe("red");
  });

  it("marks bars above the level inactive", () => {
    expect(intensityBarTone(3, 2)).toBe("inactive");
    expect(intensityBarTone(5, 4)).toBe("inactive");
  });
});
