"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatZoneTime, ZONE_LIST, type ZoneBreakdown } from "@/lib/training/zones";

/** Recharts row: a zone key → its percentage, plus the row's category label. */
type Row = { label: string } & Record<string, number | string>;

function buildRows(breakdown: ZoneBreakdown): Row[] {
  const actual: Row = { label: "Actual" };
  const ideal: Row = { label: "Ideal" };
  for (const slice of breakdown.slices) {
    actual[slice.meta.key] = Math.round(slice.percent * 10) / 10;
  }
  for (const meta of ZONE_LIST) {
    ideal[meta.key] = meta.ideal;
  }
  return [actual, ideal];
}

export function ZoneBreakdownChartClient({ breakdown }: { breakdown: ZoneBreakdown }) {
  const hasData = breakdown.totalSeconds > 0;
  const rows = buildRows(breakdown);

  return (
    <Card>
      <CardHeader className="mb-4 flex items-baseline justify-between gap-2">
        <CardTitle>Zone Distribution</CardTitle>
        {hasData && (
          <span className="tabular text-xs text-muted">
            {formatZoneTime(breakdown.totalSeconds)} total
          </span>
        )}
      </CardHeader>
      <CardContent>
        {hasData ? (
          <>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={rows}
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                  barCategoryGap="28%"
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tick={{ fill: "#79828F", fontSize: 11 }}
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
                    formatter={(value, name) => {
                      const meta = ZONE_LIST.find((m) => m.key === name);
                      return [`${value}%`, meta ? `Z${meta.zone} ${meta.name}` : name];
                    }}
                  />
                  {ZONE_LIST.map((meta, i) => {
                    const isFirst = i === 0;
                    const isLast = i === ZONE_LIST.length - 1;
                    const radius: [number, number, number, number] = isFirst
                      ? [6, 0, 0, 6]
                      : isLast
                        ? [0, 6, 6, 0]
                        : [0, 0, 0, 0];
                    return (
                      <Bar key={meta.key} dataKey={meta.key} stackId="zones" radius={radius}>
                        <Cell fill={meta.color} />
                        <Cell fill={meta.color} fillOpacity={0.4} />
                      </Bar>
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {breakdown.slices.map((slice) => (
                <li key={slice.meta.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: slice.meta.color }}
                  />
                  <span className="text-sub">
                    Z{slice.meta.zone} {slice.meta.name}
                  </span>
                  <span className="tabular ml-auto font-medium text-fg">
                    {Math.round(slice.percent)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted">
            No heart rate zone data available yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}
