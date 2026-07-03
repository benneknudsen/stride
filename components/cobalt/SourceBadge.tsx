import { cn } from "@/lib/utils";

// Data-source badge (Garmin / Strava) — mono uppercase label with a coloured dot.
const SOURCES = {
  garmin: { label: "GARMIN", dot: "var(--color-garmin)" },
  strava: { label: "STRAVA", dot: "var(--color-strava)" },
} as const;

export function SourceBadge({
  source,
  className,
}: {
  source: "garmin" | "strava";
  className?: string;
}) {
  const { label, dot } = SOURCES[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-[10px] py-[3px] font-cg-mono text-[9.5px] tracking-[0.08em] text-ink",
        className
      )}
      style={{ borderColor: "rgba(27, 41, 192, 0.18)" }}
    >
      <span className="size-[5px] rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}
