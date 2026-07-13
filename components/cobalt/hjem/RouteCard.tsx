import { GlassCard } from "@/components/cobalt/GlassCard";
import { RouteMap } from "@/components/cobalt/hjem/RouteMap";
import { formatDanish } from "@/lib/cobalt/format";

// "Rute" widget (3/12): the non-interactive map fills the card; a mono header
// floats top-left and a glass stats chip sits bottom-left. The route is the
// newest run's own decoded GPS polyline (issue #114) — so a run that carried no
// GPS has nothing to draw and falls back to a dashed placeholder, the same way
// ActivityRouteCard does on the detail page.
export function RouteCard({
  coords,
  km,
  elevation,
  name,
}: {
  coords: [number, number][];
  km: number;
  elevation: number;
  /** The run the route belongs to — names the map for screen readers. */
  name: string;
}) {
  if (coords.length === 0) {
    return (
      <GlassCard className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-widget border border-dashed border-cobalt/25 p-8 text-center">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">Rute</span>
        <p className="max-w-[240px] text-[13px] text-ink">
          Din seneste tur har ingen GPS-rute gemt, så der er intet kort at vise.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="relative min-h-[260px] overflow-hidden rounded-widget">
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
        <span className="font-cg-mono text-[11px] tracking-[0.04em] text-ink">↑ {elevation} m</span>
      </div>
    </GlassCard>
  );
}
