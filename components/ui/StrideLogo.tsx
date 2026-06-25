// Stride logo — React/TSX component (inline SVG mark).
// Drop into components/brand/. The mark is three forward-leaning rounded bars
// (motion + acceleration + data). Pass `tone` to switch color treatment.

type Tone = "duo" | "volt" | "white" | "ink";

const FILLS: Record<Tone, [string, string, string, number, number]> = {
  // [shortBar, midBar, tallBar, shortOpacity, midOpacity]
  duo:   ["#E9ECF1", "#E9ECF1", "#C6F432", 0.55, 0.8],
  volt:  ["#C6F432", "#C6F432", "#C6F432", 0.55, 0.78],
  white: ["#FFFFFF", "#FFFFFF", "#FFFFFF", 0.5, 0.72],
  ink:   ["#0B0D11", "#0B0D11", "#0B0D11", 0.55, 0.78],
};

export function StrideMark({ size = 28, tone = "duo" }: { size?: number; tone?: Tone }) {
  const [s, m, t, so, mo] = FILLS[tone];
  return (
    <svg width={size} height={(size * 84) / 96} viewBox="0 0 96 84" fill="none" aria-hidden>
      <g transform="translate(13,0) skewX(-13)">
        <rect x="8"  y="44" width="16" height="26" rx="7" fill={s} opacity={so} />
        <rect x="33" y="30" width="16" height="40" rx="7" fill={m} opacity={mo} />
        <rect x="58" y="14" width="16" height="56" rx="7" fill={t} />
      </g>
    </svg>
  );
}

export function StrideLogo({ tone = "duo", size = 24 }: { tone?: Tone; size?: number }) {
  const word = tone === "ink" ? "#0B0D11" : "#E9ECF1";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 11 }}>
      <StrideMark size={size} tone={tone} />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: size * 0.62,
          letterSpacing: "-0.03em",
          color: word,
        }}
      >
        Stride
      </span>
    </span>
  );
}
