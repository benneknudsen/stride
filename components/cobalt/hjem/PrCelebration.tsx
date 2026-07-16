"use client";

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { ConfettiBurst } from "@/components/cobalt/hjem/ConfettiBurst";

// One-time PR celebration (#122): confetti + a Cobalt Glass toast, fired the
// first time a given record run is shown. The persistent badge lives on the
// LatestActivityCard; this component only owns the transient fanfare.

/** localStorage key for a celebrated activity. */
const STORAGE_PREFIX = "stride:pr-celebrated:";
/** Lets the Hjem loading overlay (300 ms) lift before the fanfare starts. */
const START_DELAY_MS = 600;
const TOAST_MS = 5_000;

export function PrCelebration({ activityId }: { activityId: string }) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    const key = `${STORAGE_PREFIX}${activityId}`;
    try {
      if (window.localStorage.getItem(key) !== null) return;
    } catch {
      // Storage unavailable (private mode) — we can't know whether this record
      // was celebrated before, so celebrate rather than stay silent.
    }

    // prefers-reduced-motion: the badge and toast still appear, but no confetti.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const startTimer = setTimeout(() => {
      // Marked "seen" only when the fanfare actually shows — so an aborted
      // mount (or StrictMode's dev double-effect, which cleans up before this
      // fires) doesn't burn the one celebration without displaying it.
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Same private-mode case as above — show it anyway.
      }
      setShowToast(true);
      if (!reduceMotion) setShowConfetti(true);
    }, START_DELAY_MS);
    const toastTimer = setTimeout(() => setShowToast(false), START_DELAY_MS + TOAST_MS);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(toastTimer);
    };
  }, [activityId]);

  return (
    <>
      {showConfetti ? <ConfettiBurst onDone={() => setShowConfetti(false)} /> : null}
      {showToast ? (
        // Centered by a flex wrapper, not translate-x — cg-fade-up animates
        // `transform`, and the two must not fight. z-[60]: above the
        // BottomTabBar (z-50), below the confetti (z-70); bottom-24 clears the
        // tab bar on mobile.
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center">
          <GlassCard
            role="status"
            className="rounded-pill px-6 py-3 [animation:cg-fade-up_0.4s_ease_both] motion-reduce:[animation:none]"
          >
            <span className="whitespace-nowrap text-[14px] font-semibold text-cobalt">
              Ny personlig rekord! 🎉
            </span>
          </GlassCard>
        </div>
      ) : null}
    </>
  );
}
