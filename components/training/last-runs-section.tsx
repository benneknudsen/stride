import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ZONE_COLOR, type ZoneKey } from "@/lib/training/goals";
import type { PastRun, TrendStat } from "@/lib/training/runs";
import { LastRunsChartClient } from "./last-runs-chart.client";
import { SectionHeading } from "./section-heading";

const DIRECTION_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
} as const;

/** "Up" usually reads as good (more volume, better adherence); a falling pace
 * delta is also tagged `up` upstream because faster is better. Flat is muted. */
function deltaColor(direction: TrendStat["direction"]): string {
  if (direction === "up") return "var(--color-volt)";
  if (direction === "down") return "var(--color-signal)";
  return "var(--color-muted)";
}

function TrendChip({ stat }: { stat: TrendStat }) {
  const Icon = DIRECTION_ICON[stat.direction];
  const color = deltaColor(stat.direction);
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-border bg-card px-3.5 py-3 sm:px-[18px] sm:py-[15px]">
      <span className="text-[11.5px] text-muted">{stat.label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[19px] font-medium text-fg">{stat.value}</span>
        <span className="flex items-center gap-0.5 text-[11.5px] font-medium" style={{ color }}>
          <Icon className="size-3" />
          {stat.delta}
        </span>
      </div>
    </div>
  );
}

/** The zones actually present across the last-5 runs, in zone order, for the
 * chart legend. */
const ALL_ZONES: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5"];
function usedZones(runs: PastRun[]): ZoneKey[] {
  const present = new Set(runs.map((r) => r.zone));
  return ALL_ZONES.filter((z) => present.has(z));
}

/** Section 02 — recent form: trend chips over a bar chart of the last five
 * runs, each bar coloured by that run's dominant zone. */
export function LastRunsSection({ trend, runs }: { trend: TrendStat[]; runs: PastRun[] }) {
  const legend = usedZones(runs);

  return (
    <section className="pt-[34px]">
      <SectionHeading index="02" title="Last 5 runs" />

      <div className="mb-[14px] grid gap-[14px] sm:grid-cols-3">
        {trend.map((stat) => (
          <TrendChip key={stat.label} stat={stat} />
        ))}
      </div>

      <div className="rounded-[18px] border border-border bg-card p-[22px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            Distance · coloured by dominant zone
          </div>
          <div className="flex items-center gap-3">
            {legend.map((zone) => (
              <span key={zone} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: ZONE_COLOR[zone] }} />
                <span className="font-mono text-[10px] text-muted">{zone.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </div>
        <LastRunsChartClient runs={runs} />
      </div>
    </section>
  );
}
