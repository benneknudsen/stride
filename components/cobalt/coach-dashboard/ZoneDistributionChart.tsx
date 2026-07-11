"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ZoneWeek } from "@/lib/coach/dashboard";
import { ZONE_RAMP } from "@/lib/cobalt/zones";

// Zone distribution over time: one stacked bar per week, each showing the
// rolling-4-week split of training time across HR zones 1–5. The palette and the
// plain-language labels come from the shared ramp (lib/cobalt/zones.ts), so this
// chart and the per-activity zone split never drift apart.
//
// White inter-segment strokes stand in for the 2px surface gap; the legend +
// tooltip carry identity for the low-contrast light steps.

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
