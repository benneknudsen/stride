import type { ActivitySource } from "@/lib/cobalt/hjem";
import { cn } from "@/lib/utils";

// Data-source badge — mono uppercase label with a coloured dot. The app ingests
// both Strava and Garmin (#35); the badge is driven by the view-model's
// `source`, which comes from the activity's row, never by the call site.
const SOURCES: Record<ActivitySource, { label: string; dot: string }> = {
  garmin: { label: "GARMIN", dot: "var(--color-garmin)" },
  strava: { label: "STRAVA", dot: "var(--color-strava)" },
};

export function SourceBadge({ source, className }: { source: ActivitySource; className?: string }) {
  const { label, dot } = SOURCES[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-[10px] py-[3px] font-cg-mono text-[9.5px] tracking-[0.08em] text-ink",
        className
      )}
      style={{ borderColor: "color-mix(in srgb, var(--color-cobalt) 18%, transparent)" }}
    >
      <span className="size-[5px] rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}
