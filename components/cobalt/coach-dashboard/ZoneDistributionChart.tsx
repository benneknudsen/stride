"use client";

import dynamic from "next/dynamic";
import type { ZoneWeek } from "@/lib/coach/dashboard";

// Client wrapper that code-splits Recharts out of the coach route's initial
// bundle (issue #250). The chart sits in section 03 "Progression", below the
// fold, so its ~150 KB of Recharts is only fetched once this component mounts.
// ssr: false skips a server render that ResponsiveContainer can't meaningfully
// paint anyway (it needs a measured client width). The loading placeholder holds
// the chart's height to avoid layout shift.
const ZoneDistributionChartImpl = dynamic(
  () => import("./ZoneDistributionChartImpl").then((m) => m.ZoneDistributionChartImpl),
  { ssr: false, loading: () => <div className="h-[180px]" /> }
);

export function ZoneDistributionChart({ data }: { data: ZoneWeek[] }) {
  return <ZoneDistributionChartImpl data={data} />;
}
