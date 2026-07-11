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
  await expect(page.getByRole("status")).toBeHidden();
}
