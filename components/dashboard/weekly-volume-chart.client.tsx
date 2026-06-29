"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WeeklyVolumeChartClient({ data }: { data: { week: string; km: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Volume</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="week"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#79828F", fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#79828F", fontSize: 11 }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 13,
                }}
                labelStyle={{ color: "var(--foreground)" }}
                formatter={(value) => [`${value} km`, "Volume"]}
              />
              <Bar dataKey="km" fill="#C6F432" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
