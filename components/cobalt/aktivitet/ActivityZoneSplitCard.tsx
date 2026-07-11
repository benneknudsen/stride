import { GlassCard } from "@/components/cobalt/GlassCard";
import type { ActivityZoneSplitView } from "@/lib/cobalt/aktivitet";

// Zone-fordeling for one activity: a single stacked bar over the five zones
// (light → dark cobalt ramp) plus a legend carrying identity for the low-contrast
// light steps — the same ramp and plain-language labels as the coach's weekly
// ZoneDistributionChart. No Recharts here: one stacked bar is a div, and this
// keeps the page a pure Server Component.
//
// When the split is estimated from the run's average pulse (no per-second zone
// buckets from Strava), the card says so — an estimate must never read as
// measured data.
export function ActivityZoneSplitCard({ split }: { split: ActivityZoneSplitView }) {
  if (split.slices.length === 0) {
    return (
      <GlassCard className="flex min-h-[180px] items-center justify-center p-[22px] text-center text-[13px] text-ink">
        Denne tur har ingen pulsdata, så der er ingen zone-fordeling at vise.
      </GlassCard>
    );
  }

  const visible = split.slices.filter((slice) => slice.percent > 0);

  return (
    <GlassCard className="p-[22px]">
      <div className="flex h-3 w-full overflow-hidden rounded-pill">
        {visible.map((slice) => (
          <div
            key={slice.key}
            style={{ width: `${slice.percent}%`, background: slice.color }}
            className="h-full"
          />
        ))}
      </div>

      <ul className="mt-5 flex flex-col gap-2.5">
        {visible.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5 text-[12.5px]">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 flex-none rounded-[3px]"
              style={{ background: slice.color }}
            />
            <span className="flex-1 text-cobalt">{slice.label}</span>
            <span className="font-cg-mono text-[11px] text-ink">{slice.minutes} min</span>
            <span className="w-[46px] text-right font-cg-mono text-[11px] font-semibold text-cobalt">
              {Math.round(slice.percent)} %
            </span>
          </li>
        ))}
      </ul>

      {split.estimated ? (
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink">
          Estimeret ud fra turens gennemsnitspuls — Strava leverede ikke en zoneopdeling for denne
          tur.
        </p>
      ) : null}
    </GlassCard>
  );
}
