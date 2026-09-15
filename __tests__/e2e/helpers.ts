import { expect, type Page } from "@playwright/test";

/** Phone-sized: the BottomTabBar is `md:hidden` and never paints above 768px. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Wait out the RunnerLoader.
 *
 * Every Cobalt Glass page opens behind a loader — "/" swaps one in until its
 * view-model is built, /plan and /aktiviteter drop a LoadingOverlay over the
 * widget area for ~300ms and then fade it for another 600ms. Both render a
 * RunnerLoader, which carries `role="status"`. While that overlay is up it also
 * swallows clicks aimed at anything beneath it, so settle before asserting.
 */
export async function waitForContent(page: Page) {
  // Scope to the RunnerLoader: it is the only role="status" carrying an explicit
  // aria-live, and Hjem also mounts the transient PR celebration toast
  // (role="status", no aria-live). Pages can mount several loaders at once, so
  // count the visible ones down to zero instead of asserting on one locator —
  // `toBeHidden` would hit Playwright's strict mode as soon as two exist (#282).
  await expect(page.locator('[role="status"][aria-live="polite"]:visible')).toHaveCount(0);
}
