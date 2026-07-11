import { GlassCard } from "@/components/cobalt/GlassCard";
import { RouteMap } from "@/components/cobalt/hjem/RouteMap";
import { formatDanish } from "@/lib/cobalt/format";

// "Rute" on the detail page: the non-interactive Leaflet map fills the card,
// with a mono header floating top-left and a glass stats chip bottom-left —
// the same widget language as RouteCard on Hjem, but fed by *this* activity's
// decoded polyline.
//
// Runs without GPS (the demo fixtures, and any treadmill run) have no polyline,
// so the card falls back to a dashed placeholder rather than an empty grey box.
export function ActivityRouteCard({
  coords,
  km,
  elevation,
  name,
}: {
  coords: [number, number][];
  km: number;
  elevation: number | null;
  name: string;
}) {
  if (coords.length === 0) {
    return (
      <GlassCard className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-widget border border-dashed border-cobalt/25 p-8 text-center">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">Rute</span>
        <p className="max-w-[280px] text-[13px] text-ink">
          Denne tur har ingen GPS-rute gemt, så der er intet kort at vise.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="relative min-h-[300px] overflow-hidden rounded-widget">
      <RouteMap coords={coords} label={`Rutekort for ${name}`} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-[18px]">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-cobalt">
          Rute
        </span>
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
