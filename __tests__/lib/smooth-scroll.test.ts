/** @vitest-environment jsdom */
import type Lenis from "lenis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lockSmoothScroll,
  prefersReducedMotion,
  registerSmoothScroll,
  unlockSmoothScroll,
  unregisterSmoothScroll,
} from "@/lib/smooth-scroll";

// Issue #307: the Lenis bridge. The parts worth pinning are the ones the
// overlays depend on: the lock is a counter, so overlapping holders cannot
// start the scroll early; every call is a no-op when no instance is registered
// (all app-shell overlays); and reduced motion is read from matchMedia, never
// assumed.

/** A Lenis stand-in carrying only the two methods the locks call. */
function fakeLenis(): Lenis {
  return { stop: vi.fn(), start: vi.fn() } as unknown as Lenis;
}

/** jsdom has no matchMedia — install one that answers a fixed preference. */
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({ matches, media: query, addEventListener() {} })),
  });
}

describe("smooth scroll bridge", () => {
  afterEach(() => {
    delete window.__lenis;
    vi.restoreAllMocks();
  });

  it("reads the reduced-motion preference from matchMedia", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);

    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("stops the registered instance on lock and starts it on the final unlock", () => {
    const lenis = fakeLenis();
    registerSmoothScroll(lenis);

    lockSmoothScroll();
    expect(lenis.stop).toHaveBeenCalledTimes(1);

    unlockSmoothScroll();
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it("keeps scrolling stopped while another holder is still active", () => {
    const lenis = fakeLenis();
    registerSmoothScroll(lenis);

    lockSmoothScroll();
    lockSmoothScroll();

    unlockSmoothScroll();
    // One holder let go; the other still owns the page.
    expect(lenis.start).not.toHaveBeenCalled();

    unlockSmoothScroll();
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without a registered instance", () => {
    expect(() => {
      lockSmoothScroll();
      unlockSmoothScroll();
    }).not.toThrow();
  });

  it("stops a freshly registered instance while a lock is already held", () => {
    lockSmoothScroll();
    const lenis = fakeLenis();
    registerSmoothScroll(lenis);

    expect(lenis.stop).toHaveBeenCalledTimes(1);

    unlockSmoothScroll();
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it("only retires the instance that is still published", () => {
    const first = fakeLenis();
    const second = fakeLenis();
    registerSmoothScroll(first);
    registerSmoothScroll(second);

    unregisterSmoothScroll(first);
    expect(window.__lenis).toBe(second);

    unregisterSmoothScroll(second);
    expect(window.__lenis).toBeUndefined();
  });
});
