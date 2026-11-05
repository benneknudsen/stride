import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "perf", "extract-scores.mjs");

const scratch: string[] = [];
function scratchDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function lighthouseReport(overrides: Record<string, unknown> = {}) {
  return {
    requestedUrl: "http://localhost:3000/demo?utm_source=fixture",
    fetchTime: "2026-01-01T00:00:00.000Z",
    lighthouseVersion: "12.0.0",
    categories: {
      performance: { score: 0.9 },
      accessibility: { score: 1 },
      "best-practices": { score: 0.8 },
      seo: { score: 1 },
    },
    audits: {
      "largest-contentful-paint": { numericValue: 1000 },
      "cumulative-layout-shift": { numericValue: 0.01 },
      "total-blocking-time": { numericValue: 50 },
      "first-contentful-paint": { numericValue: 500 },
      "speed-index": { numericValue: 900 },
      "final-screenshot": {
        numericValue: 999,
        details: { items: [{ text: "SECRET DOM TEXT THAT MUST NOT LEAK" }] },
      },
    },
    ...overrides,
  };
}

describe("extract-scores", () => {
  it("writes only whitelisted fields and medians each URL across runs", () => {
    const input = scratchDir("stride-lhci-input-");
    const output = join(scratchDir("stride-lhci-output-"), "summary.json");

    writeFileSync(join(input, "lhr-1.json"), JSON.stringify(lighthouseReport()));
    writeFileSync(
      join(input, "lhr-2.json"),
      JSON.stringify(
        lighthouseReport({
          fetchTime: "2026-01-02T00:00:00.000Z",
          categories: {
            performance: { score: 0.7 },
            accessibility: { score: 1 },
            "best-practices": { score: 0.8 },
            seo: { score: 1 },
          },
          audits: {
            "largest-contentful-paint": { numericValue: 2000 },
            "cumulative-layout-shift": { numericValue: 0.03 },
            "total-blocking-time": { numericValue: 150 },
            "first-contentful-paint": { numericValue: 700 },
            "speed-index": { numericValue: 1100 },
          },
        })
      )
    );

    execFileSync(process.execPath, [SCRIPT, input, output], { encoding: "utf8" });
    const raw = readFileSync(output, "utf8");
    const summary = JSON.parse(raw);

    expect(summary).toHaveLength(1);
    expect(summary[0].requestedUrl).toBe("/demo");
    expect(summary[0].categories).toEqual({
      performance: 0.8,
      accessibility: 1,
      "best-practices": 0.8,
      seo: 1,
    });
    expect(summary[0].metrics).toEqual({
      "largest-contentful-paint": 1500,
      "cumulative-layout-shift": 0.02,
      "total-blocking-time": 100,
      "first-contentful-paint": 600,
      "speed-index": 1000,
    });

    expect(raw).not.toContain("final-screenshot");
    expect(raw).not.toContain("details");
    expect(raw).not.toContain("SECRET DOM TEXT");
  });
});
