"use client";

import { useLayoutEffect, useRef, useState } from "react";

// The self-drawing pace curve for the latest-activity widget. Samples (0–1,
// higher = faster) become an SVG polyline that draws itself via stroke-dasharray
// (pathLength normalised to 100) once `started` flips true, with a pulsing red
// dot pinned to the final sample.
//
// The curve wants a fixed 96px-tall band at the card's full width. A fixed
// viewBox stretched to fill (preserveAspectRatio="none") scales non-uniformly,
// which broke the dash pattern (gap mid-line), turned the round end dot into an
// ellipse and skewed the fill/gradient (#214). Instead we measure the rendered
// width and draw in actual pixels, so the viewBox maps 1:1 to the element — no
// scaling, no deformation.
const H = 96;
// The end dot sits exactly on the last sample, so without inset its right half
// gets clipped flush against the card edge (SVGs default to overflow: hidden).
// Insetting both ends keeps the dot — and the round line cap — fully on-canvas.
const PAD_X = 6;
// SSR / first-paint fallback before the width is measured. Client's first render
// uses the same value so hydration matches; the layout effect corrects it before
// the browser paints.
const W_FALLBACK = 320;

export function PaceCurve({ samples, started }: { samples: number[]; started: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(W_FALLBACK);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || W_FALLBACK);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = samples.length;
  const points = samples.map((s, i) => {
    const x = PAD_X + (i / (n - 1)) * (width - 2 * PAD_X);
    const y = H - 8 - s * (H - 20);
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const [endX, endY] = points[n - 1];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${H}`}
      className="h-[96px] w-full"
      fill="none"
      aria-hidden="true"
    >
      <path
        // Close the fill along the curve's own x-range (PAD_X … width - PAD_X) so
        // fill and stroke share an edge — closing to the raw viewBox edges left a
        // sliver of fill past the line's inset ends.
        d={`${d} L${(width - PAD_X).toFixed(1)} ${H} L${PAD_X} ${H} Z`}
        fill="url(#cg-pace-fill)"
        opacity={started ? 1 : 0}
        style={{ transition: "opacity 1.8s ease" }}
      />
      <defs>
        {/* userSpaceOnUse pins the fade to the fixed 0…H band rather than the
            fill's bounding box, so it covers the full curve height evenly. */}
        <linearGradient
          id="cg-pace-fill"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="0"
          y2={H}
        >
          {/* Relative color keeps the fade on the cobalt hue; color-mix() to
              transparent collapses the end stop to transparent black and grays
              the mid-tones. */}
          <stop offset="0%" stopColor="rgb(from var(--color-cobalt) r g b / 0.18)" />
          <stop offset="100%" stopColor="rgb(from var(--color-cobalt) r g b / 0)" />
        </linearGradient>
      </defs>
      <path
        d={d}
        pathLength={100}
        stroke="var(--color-cobalt)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={100}
        strokeDashoffset={started ? 0 : 100}
        className="motion-reduce:!transition-none"
        style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)" }}
      />
      {/* Halo ring — expands and fades behind the dot so it reads as a live
          pulse rather than a flat flicker. Hidden under reduced motion. */}
      <circle
        cx={endX}
        cy={endY}
        r={4}
        fill="var(--color-red)"
        opacity={started ? 1 : 0}
        className="animate-[cg-ping-dot_1.6s_ease-out_infinite] motion-reduce:hidden"
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "opacity 0.4s ease 1.4s",
        }}
      />
      <circle
        cx={endX}
        cy={endY}
        r={4}
        fill="var(--color-red)"
        opacity={started ? 1 : 0}
        className="animate-[cg-pulse-dot_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
        style={{ transition: "opacity 0.4s ease 1.4s" }}
      />
    </svg>
  );
}
