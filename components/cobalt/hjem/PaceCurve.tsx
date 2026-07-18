// The self-drawing pace curve for the latest-activity widget. Samples (0–1,
// higher = faster) become an SVG polyline that draws itself via stroke-dasharray
// (pathLength normalised to 100) once `started` flips true, with a pulsing red
// dot pinned to the final sample.
const W = 320;
const H = 96;

export function PaceCurve({ samples, started }: { samples: number[]; started: boolean }) {
  const n = samples.length;
  const points = samples.map((s, i) => {
    const x = (i / (n - 1)) * W;
    const y = H - 8 - s * (H - 20);
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const [endX, endY] = points[n - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[96px] w-full"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={`${d} L${W} ${H} L0 ${H} Z`}
        fill="url(#cg-pace-fill)"
        opacity={started ? 1 : 0}
        style={{ transition: "opacity 1.8s ease" }}
      />
      <defs>
        <linearGradient id="cg-pace-fill" x1="0" y1="0" x2="0" y2="1">
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
        vectorEffect="non-scaling-stroke"
        strokeDasharray={100}
        strokeDashoffset={started ? 0 : 100}
        className="motion-reduce:!transition-none"
        style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)" }}
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
