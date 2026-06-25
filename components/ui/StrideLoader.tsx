// Stride loader — animated 3-bar mark used as a loading state.
// The bars are the logo; they scale from their baseline in an equalizer wave.
// Honors prefers-reduced-motion (freezes to the static logo).
//
// Requires the keyframes in globals.css (see the "Stride loader" block there).

type Motion = "wave" | "pulse" | "step";
type Tone = "duo" | "ink";

const STAGGER: Record<Motion, [number, number, number]> = {
  wave: [0, 0.15, 0.3],
  pulse: [0, 0, 0],
  step: [0, 0.18, 0.36],
};

export function StrideLoader({
  size = 26, // unit = width of one bar, in px
  motion = "wave",
  tone = "duo", // "duo" on dark surfaces, "ink" on Volt surfaces
  label, // optional shimmer caption, e.g. "Analysing your runs…"
}: {
  size?: number;
  motion?: Motion;
  tone?: Tone;
  label?: string;
}) {
  const u = size;
  const name = motion === "step" ? "strideStep" : "strideWave";
  const dur = motion === "step" ? "1.2s" : "1s";
  const [d1, d2, d3] = STAGGER[motion];

  const tall = tone === "ink" ? "#0B0D11" : "#C6F432";
  const dim = tone === "ink" ? "#0B0D11" : "#E9ECF1";

  const bar = (h: number, opacity: number, delay: number, bg: string): React.CSSProperties => ({
    width: u,
    height: u * h,
    borderRadius: u * 0.42,
    background: bg,
    opacity,
    transformOrigin: "50% 100%",
    animation: `${name} ${dur} ease-in-out infinite`,
    animationDelay: `${delay}s`,
  });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: u * 0.7 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "flex-end",
          gap: u * 0.55,
          transform: "skewX(-13deg)",
        }}
        role="status"
        aria-label="Loading"
      >
        <span style={bar(1.6, tone === "ink" ? 0.55 : 0.5, d1, dim)} />
        <span style={bar(2.5, tone === "ink" ? 0.78 : 0.72, d2, dim)} />
        <span style={bar(3.5, 1, d3, tall)} />
      </span>
      {label && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            fontSize: u * 0.62,
            letterSpacing: "0.04em",
            backgroundImage: "linear-gradient(90deg,#79828F,#E9ECF1,#79828F)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            animation: "strideShimmer 1.8s linear infinite",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
