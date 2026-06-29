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
      title={`Zone ${meta.zone} · ${meta.name} · ${meta.description}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5",
        "font-mono text-[11px] font-semibold tracking-wide",
        "transition-colors duration-150",
        className
      )}
      style={{
        background: `${meta.color}18`,
        color: meta.color,
      }}
    >
      Zone {meta.zone}
    </span>
  );
}
