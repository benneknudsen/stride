import { expect, test } from "@playwright/test";
import { waitForContent } from "./helpers";

// Signed in (proxy.ts gates /aktiviteter) and desktop width, so the rows show
// their pace and bpm columns rather than folding them away.
test.describe("/aktiviteter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/aktiviteter");
    await waitForContent(page);
  });

  test("shows the filter chips", async ({ page }) => {
    for (const chip of ["Alle", "Rolig", "Moderat", "Hård"]) {
      await expect(page.getByRole("button", { name: chip, exact: true })).toBeVisible();
    }

    // "Alle" is the landing filter.
    await expect(page.getByRole("button", { name: "Alle", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("lists activities", async ({ page }) => {
    // One IntensityMeter per row — it's the only thing on the row guaranteed to
    // be there regardless of breakpoint, and it carries an accessible name.
    const rows = page.getByRole("img", { name: /^Intensitet:/ });
    expect(await rows.count()).toBeGreaterThan(0);

    await expect(page.getByText("km i alt")).toBeVisible();
    await expect(page.getByText("ture", { exact: true })).toBeVisible();
  });

  test("filtering narrows the list to one intensity", async ({ page }) => {
    const rows = page.getByRole("img", { name: /^Intensitet:/ });
    const intensities = () =>
      rows.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));

    // The chip only proves anything if there was something for it to remove.
    // ("rolig" is level ≤2, which the zone map labels "Rolig snak-fart".)
    const before = await intensities();
    expect(before.some((label) => !label.includes("Rolig"))).toBe(true);

    await page.getByRole("button", { name: "Rolig", exact: true }).click();
    // aria-pressed and the list flip in the same render, so this settles both.
    await expect(page.getByRole("button", { name: "Rolig", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const after = await intensities();
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((label) => label.includes("Rolig"))).toBe(true);
  });
});
