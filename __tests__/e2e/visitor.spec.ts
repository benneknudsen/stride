import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, waitForContent } from "./helpers";

// Issue #100 replaced the old /demo page — and the proxy's auth gate — with demo
// fallbacks on the four real pages (#84). The point of this suite is that someone
// with no session at all can browse every one of them, hence the empty storage
// state, which drops the signed-in cookie the other suites rely on. The viewport
// is phone-sized because the BottomTabBar is `md:hidden`.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: MOBILE_VIEWPORT,
});

test.describe("browsing without a session", () => {
  test("the old /demo route redirects to the front page", async ({ page }) => {
    await page.goto("/demo");
    // The trailing $ matters — every other app path is prefixed by "/".
    await expect(page).toHaveURL(/localhost:6969\/$/);
  });

  test("Hjem renders the demo fixtures instead of a login wall", async ({ page }) => {
    await page.goto("/");
    await waitForContent(page);

    await expect(page.getByText(/^Uge \d+ · Marathonplan$/)).toBeVisible();
    // The greeting is clock-dependent ("Godmorgen." / "Godaften."), so assert the
    // shape, not the words.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("renders every bento card on Hjem", async ({ page }) => {
    await page.goto("/");
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
    await expect(header("Restitution")).toBeVisible(); // RecoveryCard
    await expect(header("AI Coach")).toBeVisible(); // AiCoachCard

    // These two head their card with an <h2> instead.
    await expect(page.getByRole("heading", { name: "Seneste ture" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Datakilder" })).toBeVisible();
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
