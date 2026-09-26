import { RouteCardShell } from "@/components/cobalt/RouteCardShell";

// "Rute" on the detail page: the same widget as RouteCard on Hjem (see
// RouteCardShell), fed by *this* activity's decoded polyline and a size up —
// hence size and placeholder copy as the only choices this file makes. Unlike
// Hjem, no-GPS is the common case here: the demo fixtures and any treadmill run
// carry no polyline at all.
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
  return (
    <RouteCardShell
      coords={coords}
      km={km}
      elevation={elevation}
      name={name}
      minHeightClass="min-h-[300px]"
      placeholderText="Denne tur har ingen GPS-rute gemt, så der er intet kort at vise."
      placeholderWidthClass="max-w-[280px]"
    />
  );
}
