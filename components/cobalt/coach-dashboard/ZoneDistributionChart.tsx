"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ZoneWeek } from "@/lib/coach/dashboard";

// Zone distribution over time: one stacked bar per week, each showing the
// rolling-4-week split of training time across HR zones 1–5.
//
// The zone scale is ordered (recovery → maximal), so the palette is a single
// sequential cobalt ramp, light → dark, validated for monotone lightness and
// adjacent-pair CVD separation against the silver surface. White inter-segment
// strokes stand in for the 2px surface gap; the legend + tooltip carry identity
// for the low-contrast light steps.
const ZONE_RAMP: { key: keyof Omit<ZoneWeek, "week">; label: string; color: string }[] = [
  { key: "z1", label: "Z1 Restitution", color: "#ccd3f5" },
  { key: "z2", label: "Z2 Aerob", color: "#9aa6ec" },
  { key: "z3", label: "Z3 Tempo", color: "#6577e0" },
  { key: "z4", label: "Z4 Tærskel", color: "#3c4ed0" },
  { key: "z5", label: "Z5 Max", color: "#131f96" },
];

export function ZoneDistributionChart({ data }: { data: ZoneWeek[] }) {
  return (
    <div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <XAxis
              dataKey="week"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#5a5f74", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#5a5f74", fontSize: 11 }}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={{ fill: "rgba(27, 41, 192, 0.05)" }}
              contentStyle={{
                backgroundColor: "#ffffff",
                border: "1px solid #dfe1ea",
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `${value}%`,
                ZONE_RAMP.find((z) => z.key === name)?.label ?? String(name),
              ]}
            />
            {ZONE_RAMP.map((zone, i) => (
              <Bar
                key={zone.key}
                dataKey={zone.key}
                stackId="zones"
                fill={zone.color}
                stroke="#ffffff"
                strokeWidth={1}
                maxBarSize={24}
                radius={i === ZONE_RAMP.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {ZONE_RAMP.map((zone) => (
          <span key={zone.key} className="flex items-center gap-1.5 text-[11px] text-ink">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-[3px]"
              style={{ background: zone.color }}
            />
            {zone.label}
          </span>
        ))}
      </div>
    </div>
  );
}
