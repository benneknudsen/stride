import { cn } from "@/lib/utils";

// The three slowly-drifting liquid blobs behind every Cobalt Glass page.
// #344: the layer is document-bound now — `absolute inset-0` inside the shell
// that is already `relative min-h-screen` — instead of a `position: fixed`
// strip that had to keep tracking the viewport itself. A surface tied to the
// document cannot desync from the viewport the way the fixed one did when
// mobile browsers resize or offset the layout viewport (URL bar, rubber-band,
// dynamic dvh): nothing occupies a coordinate space the page doesn't own.
// The sheet paints its own silver base, so no underneath surface can ever
// shine through with a different colour.
//
// Blob geometry keeps its old values: on a sheet about one viewport tall
// (every auth screen, the hero on short pages) the layout stays exactly as
// before, and on multi-screen documents the fog rests in document space —
// thin silver behind content is continuous by construction (every radial
// fades out, nothing repeats, nothing is cut hard), so no scan region can
// meet an edge. The sheet sits first in the shell's DOM with z-auto, so the
// positioned siblings after it (content container, NavBar, BottomTabBar)
// paint above it and the glass widgets keep bleeding through. Drift pauses
// under reduced motion.
const BLOBS = [
  {
    id: "red",
    animation: "animate-[cg-drift1_14s_ease-in-out_infinite]",
    style: {
      top: -180,
      right: -120,
      width: 560,
      height: 560,
      background: "radial-gradient(circle at 35% 35%, #ee2418, #ee2418 55%, transparent 70%)",
      filter: "blur(8px)",
    },
  },
  {
    id: "cobalt",
    animation: "animate-[cg-drift2_18s_ease-in-out_infinite]",
    style: {
      top: 220,
      left: -200,
      width: 600,
      height: 600,
      background: "radial-gradient(circle at 60% 40%, #1b29c0, transparent 68%)",
      filter: "blur(12px)",
    },
  },
  {
    id: "violet",
    animation: "animate-[cg-drift3_22s_ease-in-out_infinite]",
    style: {
      bottom: -260,
      right: "18%",
      width: 680,
      height: 680,
      background: "radial-gradient(circle at 50% 40%, #4a54e0, transparent 65%)",
      filter: "blur(14px)",
    },
  },
];

export function BackgroundBlobs() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ backgroundColor: "var(--color-silver)" }}
    >
      {BLOBS.map((blob) => (
        <div
          key={blob.id}
          className={cn("absolute rounded-full motion-reduce:animate-none", blob.animation)}
          style={blob.style}
        />
      ))}
    </div>
  );
}
