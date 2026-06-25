"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { demoActivities, getWeeklyVolume } from "@/lib/demo/activities";

function getWeekLabel(weeksAgo: number): string {
  if (weeksAgo === 0) return "This Week";
  if (weeksAgo === 1) return "Last Week";
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WeeklyVolumeChart() {
  const data = Array.from({ length: 12 }, (_, i) => ({
    week: getWeekLabel(11 - i),
    km: Math.round(getWeeklyVolume(demoActivities, 11 - i) / 100) / 10,
  })).reverse();

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
                  backgroundColor: "#1A1F26",
                  border: "1px solid #262C35",
                  borderRadius: 12,
                  fontSize: 13,
                }}
                labelStyle={{ color: "#E9ECF1" }}
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
