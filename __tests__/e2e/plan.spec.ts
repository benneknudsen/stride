import { expect, test } from "@playwright/test";
import { waitForContent } from "./helpers";

// Signed in, desktop width. Both matter: /plan is auth-gated by proxy.ts, and the
// timeline swaps each marker down to a short label below 640px — "Race" instead
// of "Race 13. sep" — which is precisely the date this suite is here to check.
test.describe("/plan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plan");
    await waitForContent(page);
  });

  test("PhaseTimeline shows five phases", async ({ page }) => {
    const timeline = page.getByTestId("phase-timeline");
    await expect(timeline).toBeVisible();

    // Five phases — Adapt, Burn, Sharpen, Peak, Taper — one bar segment each.
    // (The timeline draws a sixth *marker* for race day, but race day is a
    // milestone, not a phase, and gets no segment.)
    await expect(timeline.getByTestId("phase-segment")).toHaveCount(5);

    // innerText, not textContent: each marker carries both a long and a short
    // label and hides one by breakpoint, and only innerText respects that. It also
    // applies text-transform, so the labels arrive uppercased — hence the fold.
    const labels = (await timeline.innerText()).toLowerCase();
    for (const phase of ["Adapt", "Burn", "Sharpen", "Peak", "Taper"]) {
      expect(labels).toContain(phase.toLowerCase());
    }
  });

  test("shows the race date", async ({ page }) => {
    // The timeline's last marker is race day, labelled with its short date
    // ("Race 20. sep"). The date moves with the user's race, so match the shape,
    // and match it case-insensitively — the label row is styled uppercase.
    const timeline = page.getByTestId("phase-timeline");
    expect(await timeline.innerText()).toMatch(/Race \d{1,2}\. \w+/i);

    // The red race card repeats it in full, next to the live countdown.
    const raceCard = page.getByTestId("race-day-card");
    await expect(raceCard).toBeVisible();
    await expect(raceCard).toContainText(/\d{1,2}\. \w+/);
    await expect(raceCard).toContainText(/\d+ dage/);
  });

  test("header counts down to the race", async ({ page }) => {
    await expect(page.getByText("Dage til race")).toBeVisible();
    await expect(page.getByText(/^Uge af \d+$/)).toBeVisible();
  });
});
