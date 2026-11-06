import type { AxeResults } from "axe-core";
import { describe, expect, it } from "vitest";
import { summarizeAxeResults } from "../../scripts/perf/axe-summary";

describe("axe summary", () => {
  it("keeps only url path, axe version, timestamp and per-violation id/impact/node count", () => {
    // axe hands back the full node record (html, target, failureSummary). On a
    // signed-in page that html is the user's real race data, so the summary has
    // to drop it before anything lands on disk.
    const results = {
      url: "http://localhost:6969/aktiviteter?token=secret",
      timestamp: "2026-01-01T00:00:00.000Z",
      testEngine: { name: "axe-core", version: "4.14.0" },
      violations: [
        {
          id: "color-contrast",
          impact: "serious",
          description: "PRIVATE DESCRIPTION",
          help: "PRIVATE HELP",
          nodes: [
            {
              html: "<h1>PRIVATE RUN DATA</h1>",
              target: ["h1"],
              failureSummary: "PRIVATE FAILURE",
            },
            {
              html: "<p>MORE PRIVATE RUN DATA</p>",
              target: [".card"],
              failureSummary: "PRIVATE FAILURE",
            },
          ],
        },
      ],
    } as unknown as AxeResults;

    const summary = summarizeAxeResults(results, "/aktiviteter");

    expect(summary).toEqual({
      url: "/aktiviteter",
      axeVersion: "4.14.0",
      timestamp: "2026-01-01T00:00:00.000Z",
      violations: [{ id: "color-contrast", impact: "serious", nodes: 2 }],
    });

    const raw = JSON.stringify(summary);
    expect(raw).not.toContain("html");
    expect(raw).not.toContain("target");
    expect(raw).not.toContain("failureSummary");
    expect(raw).not.toContain("PRIVATE");
    expect(raw).not.toContain("token=secret");
  });
});
