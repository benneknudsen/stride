"use client";

import Lenis from "lenis";
import { type ReactNode, useEffect } from "react";
import {
  prefersReducedMotion,
  registerSmoothScroll,
  unregisterSmoothScroll,
} from "@/lib/smooth-scroll";

/**
 * Owns the Lenis instance for one surface (issue #307). Mounted around the
 * landing page and the login form — never in the app shell — so the instance's
 * lifetime is exactly the route's: navigating away destroys it and window
 * scrolling is native again.
 *
 * `prefers-reduced-motion: reduce` means Lenis is not created at all; native
 * scroll is the baseline everywhere, smoothing is the enhancement.
 *
 * The provider renders its children unchanged (like ThemeProvider): no DOM, no
 * server round-trip, no hydration surface — both surfaces keep their
 * server-rendered markup.
 */
export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    // The portfolio's signed-off tuning: lerp 0.1 at 1:1 wheel speed.
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });
    registerSmoothScroll(lenis);

    let frame = 0;
    function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      unregisterSmoothScroll(lenis);
      lenis.destroy();
    };
  }, []);

  return children;
}
