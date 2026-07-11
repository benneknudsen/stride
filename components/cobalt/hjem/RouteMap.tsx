"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

// Non-interactive route map: Leaflet + free CARTO light_all tiles (no API key).
// Every interaction handler is disabled — this is a view, not a map UI. The
// route is a red glow polyline under a thin red stroke, with a cobalt start dot
// and a red finish dot. Leaflet is imported dynamically so it never touches SSR.
export function RouteMap({
  coords,
  label = "Rutekort over Søerne",
}: {
  coords: [number, number][];
  /** Accessible name — the activity detail page passes the run's own route. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    const el = ref.current;

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
      // A route with no points has no polyline, no markers and no bounds to fit.
      if (latlngs.length === 0) return;
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
