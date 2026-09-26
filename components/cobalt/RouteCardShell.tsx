import { GlassCard } from "@/components/cobalt/GlassCard";
import { RouteMap } from "@/components/cobalt/hjem/RouteMap";
import { formatDanish } from "@/lib/cobalt/format";

/**
 * Shared "Rute" widget (issue #283). Hjem's `RouteCard` and the detail page's
 * `ActivityRouteCard` are the same glass card over the same non-interactive map,
 * so the markup lives here once and each surface is a thin wrapper picking only
 * size and placeholder copy.
 *
 * A run with no GPS has nothing to draw, so empty `coords` renders the dashed
 * placeholder rather than an empty grey box.
 *
 * `minHeightClass` / `placeholderWidthClass` are Tailwind classes, not pixel
 * numbers: the arbitrary values must appear literally in the source for
 * Tailwind's scanner to emit them, so a `min-h-[${n}px]` template would silently
 * drop the card's height.
 */
interface RouteCardShellProps {
  coords: [number, number][];
  km: number;
  /** `null` renders no elevation chip at all — the detail page has no elevation for every run. */
  elevation: number | null;
  /** The run the route belongs to — names the map for screen readers. */
  name: string;
  minHeightClass: string;
  placeholderText: string;
  placeholderWidthClass: string;
}

export function RouteCardShell({
  coords,
  km,
  elevation,
  name,
  minHeightClass,
  placeholderText,
  placeholderWidthClass,
}: RouteCardShellProps) {
  if (coords.length === 0) {
    return (
      <GlassCard
        className={`flex ${minHeightClass} flex-col items-center justify-center gap-2 border border-dashed border-cobalt/25 p-8 text-center`}
      >
        <span className="cg-label tracking-[0.18em]">Rute</span>
        <p className={`${placeholderWidthClass} text-[13px] text-ink`}>{placeholderText}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className={`${minHeightClass} overflow-hidden`}>
      <RouteMap coords={coords} label={`Rutekort for ${name}`} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-[18px]">
        <span className="cg-label tracking-[0.18em] text-cobalt">Rute</span>
      </div>

      <div className="cg-glass pointer-events-none absolute bottom-[16px] left-[16px] flex items-center gap-4 rounded-pill px-[14px] py-[8px]">
        <span className="font-cg-mono text-[11px] font-semibold tracking-[0.04em] text-cobalt">
          {formatDanish(km, 1)} km
        </span>
        {elevation != null ? (
          <span className="font-cg-mono text-[11px] tracking-[0.04em] text-ink">
            ↑ {elevation} m
          </span>
        ) : null}
      </div>
    </GlassCard>
  );
}
