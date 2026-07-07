import type { LoadGaugeView } from "@/lib/coach/dashboard";

// Acute:chronic training-load gauge — a semicircular meter. The fill carries
// severity (status colors, never the categorical ramp); the unfilled track is a
// lighter step of the cobalt ramp. The band always reads as text + value too,
// so state is never color-alone. Pure SVG, renders on the server.

const RISK_COLORS: Record<string, string> = {
  detraining: "#6b7280",
  optimal: "var(--color-cobalt)",
  elevated: "#b45309",
  high: "var(--color-red)",
};

const RADIUS = 60;
const STROKE = 12;
const ARC_LENGTH = Math.PI * RADIUS;

export function LoadGauge({ gauge }: { gauge: LoadGaugeView }) {
  const color = gauge.risk ? RISK_COLORS[gauge.risk] : "#9aa1b6";

  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <svg
        width={160}
        height={92}
        viewBox="0 0 160 92"
        role="img"
        aria-label={`Belastningsratio ${gauge.ratio === null ? "ukendt" : gauge.ratio.toFixed(2)} — ${gauge.label}`}
      >
        <path
          d={`M ${80 - RADIUS} 80 A ${RADIUS} ${RADIUS} 0 0 1 ${80 + RADIUS} 80`}
          fill="none"
          stroke="#dfe3f8"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {gauge.fraction > 0 ? (
          <path
            d={`M ${80 - RADIUS} 80 A ${RADIUS} ${RADIUS} 0 0 1 ${80 + RADIUS} 80`}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${gauge.fraction * ARC_LENGTH} ${ARC_LENGTH}`}
          />
        ) : null}
        <text
          x={80}
          y={72}
          textAnchor="middle"
          className="fill-cobalt font-cg-display"
          fontSize={28}
        >
          {gauge.ratio === null ? "–" : gauge.ratio.toFixed(2)}
        </text>
      </svg>
      <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
        Akut / kronisk ratio
      </span>
      <span className="text-[13px] font-medium" style={{ color }}>
        {gauge.label}
      </span>
    </div>
  );
}
