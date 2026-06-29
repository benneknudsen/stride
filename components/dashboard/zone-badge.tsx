import { ZONES, type ZoneHrConfig, zoneForHeartRate } from "@/lib/training/zones";
import { cn } from "@/lib/utils";

/**
 * Small pill marking which heart-rate zone a run predominantly sat in. Used as
 * the zone indicator in the Activity Overview. Renders nothing when there's no
 * heart-rate signal to classify.
 */
export function ZoneBadge({
  averageHeartrate,
  config,
  className,
}: {
  averageHeartrate: number | null | undefined;
  config?: ZoneHrConfig;
  className?: string;
}) {
  if (averageHeartrate == null || averageHeartrate <= 0) {
    return null;
  }

  const zone = zoneForHeartRate(averageHeartrate, config);
  const meta = ZONES[zone];

  return (
    <span
      title={`Zone ${meta.zone} · ${meta.description}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5",
        "font-mono text-[10px] uppercase tracking-[0.06em] text-sub",
        className
      )}
      style={{ borderColor: `${meta.color}40` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />Z{meta.zone} ·{" "}
      {meta.name}
    </span>
  );
}
