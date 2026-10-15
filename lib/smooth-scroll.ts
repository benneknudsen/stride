import type Lenis from "lenis";

// Lenis smooth scroll (issue #307) — the landing ("/" for a visitor) and
// /login only; the app shell is a later, explicit decision. The live instance
// is published on `window.__lenis` because overlays have to reach it from
// unrelated components, and because `body { overflow: hidden }` does NOT stop
// Lenis — only a real `stop()` freezes the page under an overlay (the
// portfolio's convention 0, already paid for there).
declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

/** Reduced motion: Lenis is never activated — native scroll is the baseline. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * How many overlays currently hold the page. A counter, not a boolean, so the
 * `stop()`/`start()` pair survives overlapping holders — a menu closing while
 * a dialog is still open must not restart scrolling underneath it.
 */
let smoothScrollLocks = 0;

export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Publishes a fresh instance; a page that is already locked stops on arrival. */
export function registerSmoothScroll(lenis: Lenis): void {
  window.__lenis = lenis;
  if (smoothScrollLocks > 0) lenis.stop();
}

/** Retires an instance — only when it is still the published one. */
export function unregisterSmoothScroll(lenis: Lenis): void {
  if (window.__lenis === lenis) delete window.__lenis;
}

/**
 * Stops smooth scrolling for one holder. A no-op when Lenis is not running —
 * every overlay on the app pages (where the provider is not mounted) calls
 * this and must not fail.
 */
export function lockSmoothScroll(): void {
  smoothScrollLocks += 1;
  window.__lenis?.stop();
}

/** Releases one holder; scrolling resumes only when the last one lets go. */
export function unlockSmoothScroll(): void {
  smoothScrollLocks = Math.max(0, smoothScrollLocks - 1);
  if (smoothScrollLocks === 0) window.__lenis?.start();
}
