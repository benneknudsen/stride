import { cn } from "@/lib/utils";

// The three slowly-drifting liquid blobs behind every Cobalt Glass page.
// Fixed + pointer-events-none so they sit behind (and bleed through) the glass
// widgets without ever intercepting clicks. Drift pauses under reduced motion.
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
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
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
