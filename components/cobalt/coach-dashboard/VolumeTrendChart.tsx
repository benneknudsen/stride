"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { VolumeWeek } from "@/lib/coach/dashboard";

// Weekly running volume, km per week. Single cobalt series → no legend.
export function VolumeTrendChart({ data }: { data: VolumeWeek[] }) {
  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
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
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--color-cobalt) 5%, transparent)" }}
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe1ea",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(value) => [`${value} km`, "Volumen"]}
          />
          <Bar dataKey="km" fill="var(--color-cobalt)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
