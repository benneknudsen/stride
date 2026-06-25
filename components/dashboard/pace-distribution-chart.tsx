"use client";

import { demoActivities } from "@/lib/demo/activities";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export function PaceDistributionChart() {
  const paces = demoActivities.map((a) => a.avgPace).sort((a, b) => a - b);

  const buckets = [
    { range: "< 4:30", min: 0, max: 270 },
    { range: "4:30-5:00", min: 270, max: 300 },
    { range: "5:00-5:30", min: 300, max: 330 },
    { range: "5:30-6:00", min: 330, max: 360 },
    { range: "> 6:00", min: 360, max: Infinity },
  ];

  const data = buckets.map((b) => ({
    pace: b.range,
    count: paces.filter((p) => p >= b.min && p < b.max).length,
  }));

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
                  backgroundColor: "#1A1F26",
                  border: "1px solid #262C35",
                  borderRadius: 12,
                  fontSize: 13,
                }}
                labelStyle={{ color: "#E9ECF1" }}
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
