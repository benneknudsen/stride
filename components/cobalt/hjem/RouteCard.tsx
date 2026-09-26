import { RouteCardShell } from "@/components/cobalt/RouteCardShell";

// Hjem's "Rute" widget: the route is the newest run's own decoded GPS polyline
// (issue #114). The card itself is RouteCardShell — the detail page's
// ActivityRouteCard renders the same widget, one size up, which is why the size
// and the placeholder copy are the only things this file decides.
export function RouteCard({
  coords,
  km,
  elevation,
  name,
}: {
  coords: [number, number][];
  km: number;
  elevation: number;
  name: string;
}) {
  return (
    <RouteCardShell
      coords={coords}
      km={km}
      elevation={elevation}
      name={name}
      minHeightClass="min-h-[260px]"
      placeholderText="Din seneste tur har ingen GPS-rute gemt, så der er intet kort at vise."
      placeholderWidthClass="max-w-[240px]"
    />
  );
}
