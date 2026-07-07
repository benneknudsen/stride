"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PacePoint } from "@/lib/coach/dashboard";

// Pace-efficiency trend: median speed per heartbeat (×1000) per week. Single
// series → no legend; null weeks (thin history) render as gaps in the line.
export function PaceEfficiencyChart({ data }: { data: PacePoint[] }) {
  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#dfe1ea" strokeWidth={1} />
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
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe1ea",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(value) => [
              value == null ? "–" : `${Number(value).toFixed(2)}`,
              "Pace-efficiency",
            ]}
          />
          <Line
            type="monotone"
            dataKey="efficiency"
            stroke="var(--color-cobalt)"
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 4, fill: "var(--color-cobalt)", stroke: "#ffffff", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
