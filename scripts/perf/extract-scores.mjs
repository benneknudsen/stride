import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CATEGORY_KEYS = ["performance", "accessibility", "best-practices", "seo"];
const AUDIT_KEYS = [
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "first-contentful-paint",
  "speed-index",
];

function isLighthouseReport(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.requestedUrl === "string" &&
    typeof value.lighthouseVersion === "string" &&
    value.categories &&
    typeof value.categories === "object" &&
    value.audits &&
    typeof value.audits === "object"
  );
}

/**
 * Reduce a full Lighthouse report to the whitelisted fields only.
 *
 * Everything else in the LHR stays out of the summary: audit `details`,
 * screenshots, DOM snippets and page text never leave this function.
 */
export function extractReport(lhr) {
  if (!isLighthouseReport(lhr)) {
    throw new Error("Not a Lighthouse report: missing requestedUrl/categories/audits");
  }

  const categories = {};
  for (const key of CATEGORY_KEYS) {
    categories[key] = lhr.categories[key]?.score ?? null;
  }

  const metrics = {};
  for (const key of AUDIT_KEYS) {
    metrics[key] = lhr.audits[key]?.numericValue ?? null;
  }

  return {
    requestedUrl: new URL(lhr.requestedUrl).pathname,
    fetchTime: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    categories,
    metrics,
  };
}

export function median(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(reports) {
  const groups = new Map();

  for (const report of reports) {
    const extracted = extractReport(report);
    const group = groups.get(extracted.requestedUrl) ?? [];
    group.push(extracted);
    groups.set(extracted.requestedUrl, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([requestedUrl, runs]) => {
      const latest = runs.reduce((newest, run) =>
        Date.parse(run.fetchTime) > Date.parse(newest.fetchTime) ? run : newest
      );

      const categories = {};
      for (const key of CATEGORY_KEYS) {
        categories[key] = median(runs.map((run) => run.categories[key]));
      }

      const metrics = {};
      for (const key of AUDIT_KEYS) {
        metrics[key] = median(runs.map((run) => run.metrics[key]));
      }

      return {
        requestedUrl,
        fetchTime: latest.fetchTime,
        lighthouseVersion: latest.lighthouseVersion,
        categories,
        metrics,
      };
    });
}

function readReports(inputDir, outputPath) {
  const reports = [];

  for (const entry of readdirSync(inputDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = join(inputDir, entry.name);
    if (resolve(filePath) === resolve(outputPath)) continue;

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }

    if (isLighthouseReport(parsed)) reports.push(parsed);
  }

  return reports;
}

function main() {
  const inputArg = process.argv[2] ?? process.env.LHCI_OUT ?? ".lighthouseci/out";
  const inputDir = resolve(inputArg);
  const outputArg = process.argv[3] ?? join(inputArg, "summary.json");
  const outputPath = isAbsolute(outputArg) ? outputArg : resolve(outputArg);

  if (!existsSync(inputDir)) {
    throw new Error(`Lighthouse report directory not found: ${inputDir}`);
  }

  const summary = summarize(readReports(inputDir, outputPath));

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Wrote ${summary.length} URL(s) to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
