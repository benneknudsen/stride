import { type Goal, ZONE_COLOR, type ZoneKey } from "@/lib/training/goals";
import type { LatestRun } from "@/lib/training/runs";
import { SectionHeading } from "./section-heading";

const ALL_ZONES: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5"];
const TRACE_W = 420;
const TRACE_H = 72;

/** Map the pace-trace samples to an SVG polyline across a fixed viewBox. */
function tracePoints(samples: number[]): string {
  const step = samples.length > 1 ? TRACE_W / (samples.length - 1) : TRACE_W;
  return samples.map((y, i) => `${(i * step).toFixed(1)},${y}`).join(" ");
}

/** Verdict-coloured fit gauge colour: green when on target, volt when close,
 * signal when off. Mirrors the design's pct thresholds. */
function fitColor(pct: number): string {
  if (pct >= 80) return "#22C55E";
  if (pct >= 68) return "var(--color-volt)";
  return "var(--color-signal)";
}

function MetricTile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className="font-mono text-[22px] font-medium" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

/** Section 01 — the most recent run: headline metrics, a pace-over-distance
 * trace, the time-in-zone split, and how well it fits the committed plan. */
export function LatestRunSection({ goal, latest }: { goal: Goal; latest: LatestRun }) {
  const fit = goal.fit;
  const color = fitColor(fit.pct);
  const dash = 214; // circumference of an r=34 circle, matched to the SVG below
  const dashOffset = (dash * (1 - fit.pct / 100)).toFixed(0);

  return (
    <section className="pt-[34px]">
      <SectionHeading index="01" title="Latest run" aside={`· ${latest.when}`} />
      <div className="grid gap-[14px] lg:grid-cols-[1.5fr_1fr]">
        {/* Run detail */}
        <div className="rounded-[18px] border border-border bg-card p-4 sm:p-[22px]">
          <div className="mb-5 flex items-center justify-between">
            <div className="font-display text-[17px] font-semibold tracking-tight text-fg">
              {latest.title}
            </div>
            <span className="font-mono text-[11px] text-muted">
              {latest.distanceKm} km · {latest.duration}
            </span>
          </div>

          <div className="mb-[22px] grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-[14px]">
            <MetricTile value={latest.pace} label="Pace /km" />
            <MetricTile value={String(latest.avgHr)} label="Avg HR" color="var(--color-signal)" />
            <MetricTile value={String(latest.cadence)} label="Cadence" color="var(--color-aqua)" />
            <MetricTile value={`${latest.elevGain} m`} label="Elev gain" />
          </div>

          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            Pace over distance
          </div>
          <svg
            width="100%"
            height={TRACE_H}
            viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
            preserveAspectRatio="none"
            fill="none"
            className="block"
            role="img"
            aria-label="Pace over distance trace"
          >
            <polyline
              points={tracePoints(latest.paceTrace)}
              stroke="var(--color-volt)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="mt-[18px]">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Time in zone
            </div>
            <div className="flex h-5 gap-0.5 overflow-hidden rounded-md bg-bg">
              {ALL_ZONES.map((zone) => (
                <div
                  key={zone}
                  style={{
                    flexGrow: latest.zoneDistribution[zone],
                    flexBasis: 0,
                    background: ZONE_COLOR[zone],
                  }}
                  title={`${zone.toUpperCase()} · ${latest.zoneDistribution[zone]}%`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Fit to plan */}
        <div className="flex flex-col rounded-[18px] border border-border bg-card p-[22px]">
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            Fit to your plan
          </div>
          <div className="mb-[18px] flex items-center gap-4">
            <div className="relative size-[84px] shrink-0">
              <svg
                width="84"
                height="84"
                viewBox="0 0 84 84"
                className="-rotate-90"
                role="img"
                aria-label={`Fit to plan: ${fit.score}, ${fit.pct}%`}
              >
                <circle
                  cx="42"
                  cy="42"
                  r="34"
                  fill="none"
                  stroke="var(--color-border-2)"
                  strokeWidth="9"
                />
                <circle
                  cx="42"
                  cy="42"
                  r="34"
                  fill="none"
                  stroke={color}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={dash}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-mono text-[22px] font-semibold text-fg">
                {fit.score}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[15px] font-semibold" style={{ color }}>
                {fit.verdict}
              </div>
              <div className="text-[12.5px] leading-snug text-sub">{fit.note}</div>
            </div>
          </div>
          <div className="mt-auto border-t border-border pt-[14px]">
            <div className="mb-[9px] text-[11.5px] text-muted">Target band for {goal.short}</div>
            <div className="flex gap-[7px]">
              {ALL_ZONES.map((zone) => {
                const on = goal.band.includes(zone);
                return (
                  <div key={zone} className="flex flex-1 flex-col items-center gap-[5px]">
                    <span
                      className="h-[7px] w-full rounded-[3px]"
                      style={{
                        background: on ? ZONE_COLOR[zone] : "var(--color-border-2)",
                        opacity: on ? 1 : 0.55,
                      }}
                    />
                    <span className={`font-mono text-[9.5px] ${on ? "text-fg" : "text-muted"}`}>
                      {zone.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
