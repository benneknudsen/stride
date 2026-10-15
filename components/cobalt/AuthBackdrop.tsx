"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Issue #304: the auth pages' background had exactly one thing moving
// (BackgroundBlobs). These four small glass chips make it live: the same
// cg-glass recipe and brand marks used across Cobalt Glass, swaying with
// rotation + translate on a 4–6 s ease-in-out loop — mirrored left/right like
// the measured reference (docs/bevaegelsesstrategi.md a.5: elements 1+3 drift
// right, 2+4 left). The middle pair hides below sm, where the card fills the
// width, so nothing moves in the focus area on phones. Decorative end to end:
// aria-hidden, pointer-events-none, no entrance state — without JS (or with
// prefers-reduced-motion) the chips simply stand still at their base rotation.
type Chip = {
  id: string;
  /** Position + display; the middle pair only appears at sm+, where the card
   *  no longer spans the full width. */
  className: string;
  baseRotate: number;
  sway: { rotate: number; x: number; y: number; duration: number };
  mark: ReactNode;
};

const COBALT_BAR = "w-1 rounded-full bg-cobalt/70";

const CHIPS: Chip[] = [
  {
    id: "red-dot",
    className: "flex top-[15%] left-[5%] md:top-[18%] md:left-[12%]",
    baseRotate: -8,
    sway: { rotate: 6, x: 12, y: -16, duration: 4.5 },
    mark: <span className="size-2.5 rounded-full bg-red" />,
  },
  {
    id: "cobalt-ring",
    className: "flex top-[9%] right-[6%] md:top-[8%] md:right-[14%]",
    baseRotate: 6,
    sway: { rotate: -7, x: -12, y: -14, duration: 5 },
    mark: <span className="size-5 rounded-full border-[2.5px] border-cobalt/70" />,
  },
  {
    id: "volume-bars",
    className: "hidden sm:flex top-[58%] left-[3%] md:top-[62%] md:left-[6%]",
    baseRotate: -5,
    sway: { rotate: 8, x: 12, y: -18, duration: 4 },
    mark: (
      <span className="flex items-end gap-1">
        <span className={cn(COBALT_BAR, "h-2")} />
        <span className={cn(COBALT_BAR, "h-3.5")} />
        <span className={cn(COBALT_BAR, "h-5")} />
      </span>
    ),
  },
  {
    id: "red-ring",
    className: "hidden sm:flex top-[66%] right-[3%] md:top-[70%] md:right-[5%]",
    baseRotate: 9,
    sway: { rotate: -6, x: -12, y: -15, duration: 6 },
    mark: <span className="size-5 rounded-full border-[2.5px] border-red/70" />,
  },
];

export function AuthBackdrop() {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {CHIPS.map((chip) => (
        <motion.div
          key={chip.id}
          style={{ rotate: chip.baseRotate }}
          animate={
            reduceMotion
              ? undefined
              : {
                  rotate: chip.baseRotate + chip.sway.rotate,
                  x: chip.sway.x,
                  y: chip.sway.y,
                }
          }
          transition={{
            duration: chip.sway.duration,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "mirror",
          }}
          className={cn(
            "cg-glass absolute size-12 items-center justify-center rounded-tile md:size-16",
            chip.className
          )}
        >
          {chip.mark}
        </motion.div>
      ))}
    </div>
  );
}
