"use client";

import { useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { formatDanish } from "@/lib/cobalt/format";
import type { PaceTrendPoint } from "@/lib/cobalt/hjem";

// "Snit-pace" widget (3/12). The ring it replaces mapped average pace onto a
// fixed 4:00–6:30 band — full or empty for most runners, and a ring promises a
// fraction pace doesn't have. Instead: a per-run trend line over the same ten
// runs the Volumen bars show (faster = up, the PaceCurve convention), with the
// 7-day average as the stat and the week-over-week delta underneath. The line
// draws itself once `started` flips true; hovering (or tapping) a run reveals
// its date, pace and distance.
const W = 300;
const H = 108;
const PAD_X = 8;
const TOP = 12;
const BOTTOM = 12;
/** Below this pace spread (seconds) the extreme labels say nothing — skip them. */
const LABEL_MIN_SPAN = 3;

export function PaceTrendCard({
  points,
  paceLabel,
  deltaLabel,
  started,
}: {
  points: PaceTrendPoint[];
  /** 7-day average pace ("5:10") — the card's stat. */
  paceLabel: string;
  /** Null when there is no previous week to compare — the note row explains. */
  deltaLabel: string | null;
  started: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const n = points.length;

  // Faster = up: smaller seconds map toward TOP. A near-flat week keeps a
  // minimum 10s domain so the line sits mid-chart instead of exploding.
  const paces = points.map((p) => p.paceSeconds);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const span = Math.max(slowest - fastest, 10);
  const mid = (fastest + slowest) / 2;
  const innerH = H - TOP - BOTTOM;
  const x = (i: number) => PAD_X + (i / Math.max(n - 1, 1)) * (W - 2 * PAD_X);
  const y = (pace: number) => TOP + ((pace - (mid - span / 2)) / span) * innerH;

  const coords = points.map((p, i) => [x(i), y(p.paceSeconds)] as const);
  const d = coords
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(" ");

  const showExtremes = slowest - fastest >= LABEL_MIN_SPAN;
  const active = hovered !== null ? points[hovered] : null;

  return (
    <GlassCard className="flex flex-col justify-between gap-4 rounded-widget p-[22px]">
      <div className="flex items-center justify-between">
        <span className="cg-label tracking-[0.18em]">Snit-pace</span>
        <span className="cg-label-sm">Seneste 10 ture</span>
      </div>

      {n >= 2 ? (
        // A tap has no hover: pointerleave fires the instant the finger lifts,
        // so only a mouse actually leaving clears the highlight — the last
        // tapped run stays revealed on touch.
        <div
          className="relative"
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch") setHovered(null);
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            fill="none"
            role="img"
            aria-label={`Pace-trend over de seneste ${n} ture: hurtigst ${points[paces.indexOf(fastest)].paceLabel}, langsomst ${points[paces.indexOf(slowest)].paceLabel} pr. km`}
          >
            {/* Recessive extremes: hairlines through the fastest/slowest run,
                labelled in ink — the only axis a card this size can afford. */}
            {showExtremes
              ? [fastest, slowest].map((pace, i) => (
                  <g key={pace}>
                    <line
                      x1={PAD_X}
                      x2={W - PAD_X}
                      y1={y(pace)}
                      y2={y(pace)}
                      stroke="color-mix(in srgb, var(--color-ink) 18%, transparent)"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD_X}
                      y={i === 0 ? y(pace) - 4 : y(pace) + 11}
                      fill="var(--color-ink)"
                      fontSize={9}
                      letterSpacing="0.08em"
                      className="font-cg-mono"
                    >
                      {points[paces.indexOf(pace)].paceLabel}
                    </text>
                  </g>
                ))
              : null}

            <path
              d={`${d} L${coords[n - 1][0].toFixed(1)} ${H} L${coords[0][0].toFixed(1)} ${H} Z`}
              fill="url(#cg-pace-trend-fill)"
              opacity={started ? 1 : 0}
              style={{ transition: "opacity 1.6s ease" }}
            />
            <defs>
              <linearGradient id="cg-pace-trend-fill" x1="0" y1="0" x2="0" y2="1">
                {/* Relative color keeps the fade on the cobalt hue; color-mix()
                    to transparent collapses the end stop to transparent black
                    and grays the mid-tones. */}
                <stop offset="0%" stopColor="rgb(from var(--color-cobalt) r g b / 0.14)" />
                <stop offset="100%" stopColor="rgb(from var(--color-cobalt) r g b / 0)" />
              </linearGradient>
            </defs>

            <path
              d={d}
              pathLength={100}
              stroke="var(--color-cobalt)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={100}
              strokeDashoffset={started ? 0 : 100}
              className="motion-reduce:!transition-none"
              style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)" }}
            />

            {/* Hovered run: a cobalt marker with a surface ring. */}
            {hovered !== null && hovered !== n - 1 ? (
              <circle
                cx={coords[hovered][0]}
                cy={coords[hovered][1]}
                r={4}
                fill="var(--color-cobalt)"
                stroke="var(--color-silver)"
                strokeWidth={2}
              />
            ) : null}

            {/* The most recent run: the red end-dot, pulsing like PaceCurve's. */}
            <circle
              cx={coords[n - 1][0]}
              cy={coords[n - 1][1]}
              r={4}
              fill="var(--color-red)"
              stroke="var(--color-silver)"
              strokeWidth={2}
              opacity={started ? 1 : 0}
              className="animate-[cg-pulse-dot_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
              style={{ transition: "opacity 0.4s ease 1.2s" }}
            />

            {/* Hit bands: one full-height slot per run, wider than the mark. */}
            {points.map((p, i) => (
              <rect
                key={p.id}
                x={i === 0 ? 0 : (x(i - 1) + x(i)) / 2}
                y={0}
                width={
                  (i === n - 1 ? W : (x(i) + x(i + 1)) / 2) - (i === 0 ? 0 : (x(i - 1) + x(i)) / 2)
                }
                height={H}
                fill="transparent"
                onPointerEnter={() => setHovered(i)}
                onPointerDown={() => setHovered(i)}
              />
            ))}
          </svg>

          {active !== null ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-tile px-2.5 py-1.5 font-cg-mono text-[10px] tracking-[0.04em] text-cobalt"
              style={{
                left: `${Math.min(84, Math.max(16, (coords[hovered ?? 0][0] / W) * 100))}%`,
                top: `${(coords[hovered ?? 0][1] / H) * 100}%`,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(255,255,255,0.9)",
                boxShadow: "0 6px 20px color-mix(in srgb, var(--color-cobalt) 16%, transparent)",
              }}
            >
              {active.dateLabel} · <span className="font-semibold">{active.paceLabel}</span> /km ·{" "}
              {formatDanish(active.km, 1)} km
            </div>
          ) : null}

          {/* The trend as text, for screen readers. */}
          <table className="sr-only">
            <caption>Pace pr. tur, ældste først</caption>
            <thead>
              <tr>
                <th>Dato</th>
                <th>Pace pr. km</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>{p.dateLabel}</td>
                  <td>{p.paceLabel}</td>
                  <td>{formatDanish(p.km, 1)} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex h-[86px] items-center justify-center text-center cg-label">
          for få ture til en trend
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-cg-display text-[26px] font-bold leading-none tracking-[-0.03em] text-cobalt">
            {paceLabel}
          </span>
          <span className="cg-label">/km · snit 7 dage</span>
        </div>
        {deltaLabel !== null ? (
          <div>
            <span className="font-cg-mono text-[12px] font-semibold tracking-[0.04em] text-red">
              {deltaLabel}
            </span>
            <span className="ml-2 text-[11px] text-ink">mod sidste uge</span>
          </div>
        ) : (
          <div className="text-[11px] text-ink">for få ture til sammenligning</div>
        )}
      </div>
    </GlassCard>
  );
}
