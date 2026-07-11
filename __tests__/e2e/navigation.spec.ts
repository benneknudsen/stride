import { expect, test } from "@playwright/test";
import { MOBILE_VIEWPORT, waitForContent } from "./helpers";

// The BottomTabBar is `md:hidden`, so this walk only exists below 768px.
// It runs signed in (the project's default storage state), so the pages under
// test serve live data. The same walk as a visitor — on the demo fallbacks — is
// visitor.spec.ts (#100).
test.use({ viewport: MOBILE_VIEWPORT });

test.describe("BottomTabBar navigation", () => {
  test("walks Hjem → Aktiviteter → Plan → Hjem", async ({ page }) => {
    await page.goto("/");
    await waitForContent(page);

    const tabBar = page.getByRole("navigation", { name: "Primær navigation" });

    await tabBar.getByRole("link", { name: "Aktiviteter" }).click();
    await expect(page).toHaveURL(/\/aktiviteter$/);
    await expect(page.getByRole("heading", { name: /Alle dine ture/ })).toBeVisible();
    await waitForContent(page);

    await tabBar.getByRole("link", { name: "Plan" }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByText("Dage til race")).toBeVisible();
    await waitForContent(page);

    await tabBar.getByRole("link", { name: "Hjem" }).click();
    // The trailing $ matters — /aktiviteter and /plan are both prefixed by "/".
    await expect(page).toHaveURL(/localhost:6969\/$/);
    await expect(page.getByText(/^Uge \d+ · Marathonplan$/)).toBeVisible();
  });

  test("marks the current tab as the active page", async ({ page }) => {
    await page.goto("/plan");
    await waitForContent(page);

    const tabBar = page.getByRole("navigation", { name: "Primær navigation" });
    await expect(tabBar.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(tabBar.getByRole("link", { name: "Hjem" })).not.toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
