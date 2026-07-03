import { describe, expect, it } from "vitest";
import { formatDanish, intensityBarTone } from "@/lib/cobalt/format";

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
