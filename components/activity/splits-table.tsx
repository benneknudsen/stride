"use client";

import { formatPace } from "@/lib/metrics";
import type { Split } from "@/types/domain";

/** Per-split breakdown of pace, elevation and heart rate for an activity. */
export function SplitsTable({ splits }: { splits: Split[] | null }) {
  if (!splits || splits.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No split data available</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-[0.12em] text-muted">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Pace</th>
            <th className="px-4 py-2 font-medium">Elevation</th>
            <th className="px-4 py-2 font-medium">HR</th>
          </tr>
        </thead>
        <tbody>
          {splits.map((split) => (
            <tr key={split.index} className="border-b border-border last:border-0 even:bg-card-2">
              <td className="px-4 py-2 tabular text-sub">{split.index}</td>
              <td className="px-4 py-2 tabular font-medium text-volt">
                {formatPace(split.averageSpeed)}
                <span className="ml-1 text-xs text-muted">/km</span>
              </td>
              <td className="px-4 py-2 tabular text-fg">
                {split.elevationDifference != null
                  ? `${split.elevationDifference > 0 ? "+" : ""}${Math.round(split.elevationDifference)} m`
                  : "--"}
              </td>
              <td className="px-4 py-2 tabular text-signal">
                {split.averageHeartrate != null
                  ? `${Math.round(split.averageHeartrate)} bpm`
                  : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
