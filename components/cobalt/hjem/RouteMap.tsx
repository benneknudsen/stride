"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

// Non-interactive route map: Leaflet + free CARTO light_all tiles (no API key).
// Every interaction handler is disabled — this is a view, not a map UI. The
// route is a red glow polyline under a thin red stroke, with a cobalt start dot
// and a red finish dot. Leaflet is imported dynamically so it never touches SSR.
export function RouteMap({
  coords,
  label,
}: {
  coords: [number, number][];
  /** Accessible name — each caller passes the run whose route this is. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    const el = ref.current;

    // A route with no points has nothing to draw, and Leaflet needs a view set
    // before it will take a layer — so don't build a map at all. Both callers
    // render a placeholder instead of this component in that case.
    if (coords.length === 0) return;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el || el.dataset.cgInit) return;
      el.dataset.cgInit = "1";

      map = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      const latlngs = coords.map(([lat, lng]) => L.latLng(lat, lng));
      L.polyline(latlngs, { color: "#ee2418", weight: 9, opacity: 0.22 }).addTo(map);
      L.polyline(latlngs, { color: "#ee2418", weight: 3.5, opacity: 1 }).addTo(map);
      L.circleMarker(latlngs[0], {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: "#1b29c0",
        fillOpacity: 1,
      }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ee2418",
        fillOpacity: 1,
      }).addTo(map);

      map.fitBounds(L.latLngBounds(latlngs), { padding: [22, 22] });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      if (el) delete el.dataset.cgInit;
    };
  }, [coords]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="absolute inset-0"
      style={{ background: "#e9eae5" }}
    />
  );
}
