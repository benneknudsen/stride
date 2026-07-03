import { GlassCard } from "@/components/cobalt/GlassCard";
import { RouteMap } from "@/components/cobalt/hjem/RouteMap";
import { formatDanish } from "@/lib/cobalt/format";

// "Rute" widget (3/12): the non-interactive map fills the card; a mono header
// floats top-left and a glass stats chip sits bottom-left.
export function RouteCard({
  coords,
  km,
  elevation,
}: {
  coords: [number, number][];
  km: number;
  elevation: number;
}) {
  return (
    <GlassCard className="relative min-h-[260px] overflow-hidden rounded-widget">
      <RouteMap coords={coords} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-[18px]">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-cobalt">
          Rute
        </span>
        <span className="font-cg-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">
          Søerne Øst
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
