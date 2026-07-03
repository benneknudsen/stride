import { GlassCard } from "@/components/cobalt/GlassCard";
import { PaceCurve } from "@/components/cobalt/hjem/PaceCurve";
import { SourceBadge } from "@/components/cobalt/SourceBadge";
import { formatDanish } from "@/lib/cobalt/format";
import type { LatestActivityView } from "@/lib/cobalt/hjem";

// The big "Seneste aktivitet" widget (6/12): header (mono label + Garmin badge
// + timestamp), a 30px title with a plain-language zone pill, four key metrics
// (heart rate in red) and the self-drawing pace curve.
function Metric({
  value,
  unit,
  label,
  red,
}: {
  value: string;
  unit: string;
  label: string;
  red?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`font-cg-display text-[34px] font-bold leading-none tracking-[-0.03em] ${red ? "text-red" : "text-cobalt"}`}
      >
        {value}
        <span className="ml-1 text-[15px] font-semibold text-ink">{unit}</span>
      </div>
      <div className="mt-1.5 font-cg-mono text-[9.5px] uppercase tracking-[0.16em] text-ink">
        {label}
      </div>
    </div>
  );
}

export function LatestActivityCard({
  latest,
  started,
}: {
  latest: LatestActivityView;
  started: boolean;
}) {
  return (
    <GlassCard className="flex flex-col gap-5 rounded-widget p-[26px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">
          Seneste aktivitet
        </span>
        <div className="flex items-center gap-3">
          <SourceBadge source="garmin" />
          <span className="font-cg-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">
            {latest.dayLabel} · {latest.clock}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="m-0 font-cg-display text-[30px] font-bold tracking-[-0.03em] text-cobalt">
          {latest.name}
        </h2>
        <span
          className={`rounded-pill px-[12px] py-[5px] text-[12px] font-medium ${
            latest.zone.tone === "red" ? "text-red" : "text-cobalt"
          }`}
          style={{
            background: latest.zone.tone === "red" ? "rgba(238,36,24,0.1)" : "rgba(27,41,192,0.09)",
          }}
        >
          Zone {latest.zone.level} · {latest.zone.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Metric value={formatDanish(latest.km, 1)} unit="km" label="Distance" />
        <Metric value={latest.paceLabel} unit="/km" label="Snit-pace" />
        <Metric value={String(latest.hr)} unit="bpm" label="Puls" red />
        <Metric value={String(latest.spm)} unit="spm" label="Kadence" />
      </div>

      <div className="-mb-1">
        <PaceCurve samples={latest.paceCurve} started={started} />
      </div>
    </GlassCard>
  );
}
