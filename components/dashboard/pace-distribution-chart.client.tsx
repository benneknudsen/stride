"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PaceDistributionChartClient({ data }: { data: { pace: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pace Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="voltGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C6F432" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#C6F432" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="pace"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#79828F", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#79828F", fontSize: 11 }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 13,
                }}
                labelStyle={{ color: "var(--foreground)" }}
                formatter={(value) => [`${value} runs`, "Count"]}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#C6F432"
                strokeWidth={2}
                fill="url(#voltGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
