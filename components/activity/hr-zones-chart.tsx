"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HrZone } from "@/types/domain";

/** Colour per heart-rate zone (1 → 5), easy → maximal. */
const ZONE_COLORS: Record<number, string> = {
  1: "#94a3b8",
  2: "#22c55e",
  3: "#eab308",
  4: "#f97316",
  5: "#ef4444",
};

/** Human label for a zone, e.g. "Zone 2 (120–145)" or "Zone 5 (165+)". */
function zoneLabel(zone: HrZone): string {
  if (zone.max == null) {
    return `Zone ${zone.zone} (${zone.min}+)`;
  }
  return `Zone ${zone.zone} (${zone.min}–${zone.max})`;
}

export function HrZonesChart({ hrZones }: { hrZones: HrZone[] | null }) {
  if (!hrZones || hrZones.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No heart rate zone data available</p>;
  }

  const data = hrZones.map((zone) => ({
    zone: zone.zone,
    label: `Z${zone.zone}`,
    fullLabel: zoneLabel(zone),
    minutes: Math.round((zone.seconds / 60) * 10) / 10,
    color: ZONE_COLORS[zone.zone] ?? "#94a3b8",
  }));

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="label"
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
            cursor={{ fill: "var(--color-fg)", fillOpacity: 0.04 }}
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 13,
            }}
            labelStyle={{ color: "var(--foreground)" }}
            labelFormatter={(_, payload) => payload?.[0]?.payload.fullLabel ?? ""}
            formatter={(value) => [`${value} min`, "Time"]}
          />
          <Bar dataKey="minutes" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((entry) => (
              <Cell key={entry.zone} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
