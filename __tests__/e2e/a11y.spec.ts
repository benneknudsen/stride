import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { summarizeAxeResults } from "../../scripts/perf/axe-summary";
import { MOBILE_VIEWPORT, waitForContent } from "./helpers";

// Collect, do not gate. axe against the current Cobalt Glass pages finds real
// violations; failing the run on them would make the whole e2e suite red for a
// baseline nobody has fixed yet. A test only fails here when the page itself
// does not load. The orchestrator counts the violations from the JSON files.
//
// Signed out by default. A signed-in run passes A11Y_STORAGE_STATE (a cookie
// jar) so the pages render the user's own data, and A11Y_BASE_URL so the scan
// can target a running server — playwright.config.ts skips its dev server when
// that variable is set.
const signedOut = { cookies: [], origins: [] };

test.use({
  storageState: process.env.A11Y_STORAGE_STATE ?? signedOut,
  viewport: MOBILE_VIEWPORT,
});

const PAGES = [
  { slug: "home", path: "/" },
  { slug: "demo", path: "/demo" },
  { slug: "aktiviteter", path: "/aktiviteter" },
  { slug: "plan", path: "/plan" },
  { slug: "coach", path: "/dashboard/coach" },
  { slug: "login", path: "/login" },
];

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const OUT_DIR = process.env.A11Y_OUT ?? "test-results/a11y";

for (const { slug, path } of PAGES) {
  test(`${path} has no page-level load failure`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response, `${path} did not return a response`).not.toBeNull();
    expect(response?.ok(), `${path} responded ${response?.status()}`).toBeTruthy();
    await waitForContent(page);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const summary = summarizeAxeResults(results, new URL(page.url()).pathname);

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${slug}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  });
}
