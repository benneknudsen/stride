import type { AxeResults } from "axe-core";

export type AxeViolationSummary = {
  id: string;
  impact: string | null;
  nodes: number;
};

export type AxeSummary = {
  url: string;
  axeVersion: string;
  timestamp: string;
  violations: AxeViolationSummary[];
};

/**
 * Reduce a full axe result to the whitelist that may be written to disk.
 *
 * axe's own `nodes` entries carry `html`, `target` and `failureSummary`, and on
 * the signed-in pages that html is the user's real race data. Only the path,
 * axe version, timestamp and a per-violation id/impact/node count survive.
 */
export function summarizeAxeResults(results: AxeResults, urlPath: string): AxeSummary {
  return {
    url: urlPath,
    axeVersion: results.testEngine.version,
    timestamp: results.timestamp,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      nodes: violation.nodes.length,
    })),
  };
}
