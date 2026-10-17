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

function Mark({ fill, children }: { fill: "fill-red/70" | "fill-cobalt/70"; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", fill)} aria-hidden="true">
      {children}
    </svg>
  );
}

// Four running/training motifs, one per chip: a stopwatch (intervals/tempo), a
// route pin (where the run goes), a running shoe (the run itself) and a pulse
// (heart-rate effort). They are solid, painted silhouettes rather than thin
// outlines, so all four carry the same visual weight as the old filled dot and
// bars, and every mark uses the same 70% brand alpha.
const CHIPS: Chip[] = [
  {
    id: "stopwatch",
    className: "flex top-[15%] left-[5%] md:top-[18%] md:left-[12%]",
    baseRotate: -8,
    sway: { rotate: 6, x: 12, y: -16, duration: 4.5 },
    mark: (
      <Mark fill="fill-red/70">
        <path d="M10.2 1.6h3.6a1.1 1.1 0 0 1 1.1 1.1v1.6a1.1 1.1 0 0 1-1.1 1.1h-3.6a1.1 1.1 0 0 1-1.1-1.1V2.7a1.1 1.1 0 0 1 1.1-1.1Z" />
        <path d="M11.1 5.2h1.8v2.2h-1.8z" />
        <path d="M18.1 5.5l2 2-2 2-2-2z" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 6.4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM11.1 8.2h1.8v6.2h-1.8z"
        />
      </Mark>
    ),
  },
  {
    id: "route-pin",
    className: "flex top-[9%] right-[6%] md:top-[8%] md:right-[14%]",
    baseRotate: 6,
    sway: { rotate: -7, x: -12, y: -14, duration: 5 },
    mark: (
      <Mark fill="fill-cobalt/70">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2.2c-3.9 0-7 3.1-7 7 0 5.2 7 12.6 7 12.6s7-7.4 7-12.6c0-3.9-3.1-7-7-7Zm0 3.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z"
        />
      </Mark>
    ),
  },
  {
    id: "running-shoe",
    className: "hidden sm:flex top-[58%] left-[3%] md:top-[62%] md:left-[6%]",
    baseRotate: -5,
    sway: { rotate: 8, x: 12, y: -18, duration: 4 },
    mark: (
      <Mark fill="fill-cobalt/70">
        <path d="M2 14.4h20v1.7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
        <path d="M3 14.5c0-1.6 1.1-2.9 2.7-3.2l4.1-1 2.2-3c.6-.8 1.6-1.1 2.5-.8l1.4.6 2.2-1.5c.9-.6 2.1-.4 2.8.4l.8.9c.5.6.8 1.3.8 2.1V14.5z" />
      </Mark>
    ),
  },
  {
    id: "heart-rate",
    className: "hidden sm:flex top-[66%] right-[3%] md:top-[70%] md:right-[5%]",
    baseRotate: 9,
    sway: { rotate: -6, x: -12, y: -15, duration: 6 },
    mark: (
      <Mark fill="fill-red/70">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 20C9.9 18.4 4 13.9 4 9.2 4 6.2 6.3 4 9.2 4c1.3 0 2.5.7 3.2 1.8C13.1 4.7 14.3 4 15.6 4c2.9 0 5.2 2.2 5.2 5.2 0 4.7-5.9 9.2-8.8 10.8Zm-5.8-10.5H8.8L9.7 7.3l1.6 6.1 1.4-5.4.7 1.5h4.4v1.4h-3.9l-.7-1.3-1.9 5.4-1.8-6.2-.8 2.1H6.2Z"
        />
      </Mark>
    ),
  },
];

export function AuthBackdrop() {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {CHIPS.map((chip) => (
        <motion.div
          key={chip.id}
          data-chip={chip.id}
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
