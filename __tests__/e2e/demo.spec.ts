import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, waitForContent } from "./helpers";

// /demo is the one route proxy.ts leaves public, so the point of this suite is
// that it renders for someone with no session at all — hence the empty storage
// state, which drops the signed-in cookie the other suites rely on. The viewport
// is phone-sized because the BottomTabBar is `md:hidden`.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: MOBILE_VIEWPORT,
});

test.describe("/demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo");
    await waitForContent(page);
  });

  test("renders the hero", async ({ page }) => {
    await expect(page.getByText(/^Uge \d+ · Marathonplan$/)).toBeVisible();
    // The greeting is clock-dependent ("Godmorgen." / "Godaften.") and the second
    // line is the recovery band's sentence, so assert the shape, not the words.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Demo-tilstand")).toBeVisible();
  });

  test("renders every bento card", async ({ page }) => {
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

  test("shows the BottomTabBar with four tabs", async ({ page }) => {
    const tabBar = page.getByRole("navigation", { name: "Primær navigation" });
    await expect(tabBar).toBeVisible();

    const tabs = tabBar.getByRole("link");
    await expect(tabs).toHaveCount(4);
    await expect(tabs).toHaveText(["Hjem", "Aktiviteter", "Coach", "Plan"]);
  });
});
