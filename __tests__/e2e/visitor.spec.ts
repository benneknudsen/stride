import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, waitForContent } from "./helpers";

// Issue #100 replaced the old /demo page — and the proxy's auth gate — with demo
// fallbacks on the four real pages (#84). The point of this suite is that someone
// with no session at all can browse every one of them, hence the empty storage
// state, which drops the signed-in cookie the other suites rely on. The viewport
// is phone-sized because the BottomTabBar is `md:hidden`.
//
// The front page itself now greets a visitor with the Velkommen landing page;
// the demo dashboard lives at the clean "/demo" (DEMO_HOME_ROUTE), which
// next.config.ts rewrites to the front page reading "?demo=1".
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: MOBILE_VIEWPORT,
});

test.describe("browsing without a session", () => {
  test("the old /demo URL serves the demo dashboard in place (rewrite, not redirect)", async ({
    page,
  }) => {
    await page.goto("/demo");
    // next.config.ts rewrites /demo → /?demo=1, so the browser keeps the pretty
    // URL; a redirect would have bounced it to "/" instead.
    await expect(page).toHaveURL(/localhost:6969\/demo$/);
    await waitForContent(page);
    // The rewrite has to deliver the dashboard itself — the URL would still be
    // right if the front page regressed to a login wall or a blank render.
    await expect(page.getByText(/^Uge \d+ · Silkeborg Halvmarathon$/)).toBeVisible();
  });

  test("the front page is the Velkommen landing, with a way into the demo", async ({ page }) => {
    await page.goto("/");
    await waitForContent(page);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Al din løbedata");
    // A landing page, not the app: no NavBar/BottomTabBar (LandingChromeGate) —
    // the landing brings its own header with a login link instead.
    await expect(page.getByRole("navigation", { name: "Primær navigation" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log ind" }).first()).toBeVisible();
    // Two demo CTAs (hero + footer band) — following one lands in the demo
    // dashboard at the clean "/demo", which stays in the URL (rewrite).
    await page.getByRole("link", { name: "Udforsk demoen" }).first().click();
    await expect(page).toHaveURL(/\/demo$/);
    await waitForContent(page);
    await expect(page.getByText(/^Uge \d+ · Silkeborg Halvmarathon$/)).toBeVisible();
    // …where the chrome is back, so the visitor can browse the demo (#100).
    await expect(page.getByRole("navigation", { name: "Primær navigation" })).toBeVisible();
  });

  test("Hjem (demo) renders the demo fixtures instead of a login wall", async ({ page }) => {
    await page.goto("/?demo=1");
    await waitForContent(page);

    await expect(page.getByText(/^Uge \d+ · Silkeborg Halvmarathon$/)).toBeVisible();
    // The greeting is clock-dependent ("Godmorgen." / "Godaften."), so assert the
    // shape, not the words.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("renders every bento card on Hjem", async ({ page }) => {
    await page.goto("/?demo=1");
    await waitForContent(page);

    // Most cards announce themselves with a mono <span> header. Scoping to the
    // element matters for "Snit-pace", which is both AvgPaceRing's header and one
    // of LatestActivityCard's metric labels — an unscoped text match hits both.
    const header = (name: string) =>
      page.locator("span").filter({ hasText: new RegExp(`^${name}$`) });

    await expect(page.getByRole("link", { name: /Se plan/ })).toBeVisible(); // PlanStrip
    await expect(header("Seneste aktivitet")).toBeVisible(); // LatestActivityCard
    await expect(header("Rute")).toBeVisible(); // RouteCard
    await expect(header("Snit-pace")).toBeVisible(); // AvgPaceRing
    await expect(header("Volumen")).toBeVisible(); // VolumeCard
    await expect(header("Readiness")).toBeVisible(); // RecoveryCard
    await expect(header("AI Coach")).toBeVisible(); // AiCoachCard

    // These two head their card with an <h2> instead.
    await expect(page.getByRole("heading", { name: "Seneste ture" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Datakilder" })).toBeVisible();
  });

  test("the Rute card's map is actually painted on the demo", async ({ page }) => {
    await page.goto("/demo");
    await waitForContent(page);

    // RouteMap marks its container with data-cg-init once MapLibre is up (#276).
    // The "Rute" header stays visible through both the 0-height bug and the
    // dot-per-vertex bug, so assert the geometry and the painted canvas instead.
    const map = page.locator("[data-cg-init]");
    await expect(map).toBeVisible();

    const box = await map.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);

    const canvas = map.locator("canvas");
    await expect(canvas).toHaveCount(1);
    const painted = await canvas.evaluate((el) => ({
      width: (el as HTMLCanvasElement).width,
      height: (el as HTMLCanvasElement).height,
    }));
    expect(painted.width).toBeGreaterThan(0);
    expect(painted.height).toBeGreaterThan(0);
  });

  test("Aktiviteter, Coach and Plan are reachable too", async ({ page }) => {
    await page.goto("/aktiviteter");
    await waitForContent(page);
    await expect(page.getByRole("heading", { name: /Alle dine ture/ })).toBeVisible();

    await page.goto("/plan");
    await waitForContent(page);
    await expect(page.getByText("Dage til race")).toBeVisible();

    await page.goto("/dashboard/coach");
    await waitForContent(page);
    await expect(page.getByRole("heading", { level: 1, name: "Coach" })).toBeVisible();
  });

  test("shows the BottomTabBar with four tabs, marking the open page", async ({ page }) => {
    await page.goto("/plan");
    await waitForContent(page);

    const tabBar = page.getByRole("navigation", { name: "Primær navigation" });
    await expect(tabBar).toBeVisible();

    const tabs = tabBar.getByRole("link");
    await expect(tabs).toHaveCount(4);
    await expect(tabs).toHaveText(["Hjem", "Aktiviteter", "Coach", "Plan"]);

    await expect(tabBar.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
