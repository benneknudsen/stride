"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ZONE_COLOR, type ZoneKey } from "@/lib/training/goals";
import type { PastRun } from "@/lib/training/runs";

interface ChartDatum {
  day: string;
  distanceKm: number;
  pace: string;
  zone: ZoneKey;
}

/** Recharts bar chart for "02 Last 5 runs" — one bar per run, coloured by the
 * run's dominant zone. Client component: Recharts needs the DOM. */
export function LastRunsChartClient({ runs }: { runs: PastRun[] }) {
  const data: ChartDatum[] = runs.map((r) => ({
    day: r.day,
    distanceKm: r.distanceKm,
    pace: r.pace,
    zone: r.zone,
  }));

  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#79828F", fontSize: 11 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#79828F", fontSize: 11 }}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            cursor={{ fill: "var(--color-border-2)", opacity: 0.25 }}
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 13,
            }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(value, _name, item) => [
              `${value} km · ${item?.payload?.pace}/km · ${String(item?.payload?.zone).toUpperCase()}`,
              "Run",
            ]}
          />
          <Bar dataKey="distanceKm" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {data.map((d) => (
              <Cell key={d.day} fill={ZONE_COLOR[d.zone]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
