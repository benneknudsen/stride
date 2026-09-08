"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// Non-interactive route map: MapLibre GL + OpenFreeMap's keyless Positron style
// (issue #275 — CARTO raster tiles started watermarking without an API key).
// Every interaction handler is disabled — this is a view, not a map UI. The
// route is a GeoJSON line: a red glow stroke under a thin red stroke, with a
// cobalt start dot and a red finish dot. MapLibre is imported dynamically so it
// never touches SSR.
//
// The v6 ESM build spawns `dist/maplibre-gl-worker.mjs` relative to its module
// URL, which no bundler serves, so a same-origin copy of the worker (+ its
// `maplibre-gl-shared.mjs` import) lives in `public/` and is pointed to here.
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
    let map: import("maplibre-gl").Map | undefined;
    const el = ref.current;

    // A route with no points has nothing to draw — both callers render a
    // placeholder instead of this component in that case.
    if (coords.length === 0) return;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !el || el.dataset.cgInit) return;
      el.dataset.cgInit = "1";
      maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

      map = new maplibregl.Map({
        container: el,
        style: "https://tiles.openfreemap.org/styles/positron",
        interactive: false,
        // OpenFreeMap/OSM attribution is a license requirement — compact keeps
        // it discreet but one click away.
        attributionControl: { compact: true },
      });

      // GeoJSON is [lng, lat]; our props are [lat, lng].
      const positions = coords.map(([lat, lng]) => [lng, lat] as [number, number]);

      map.on("load", () => {
        if (cancelled || !map) return;
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: positions },
              },
              {
                type: "Feature",
                properties: { kind: "start" },
                geometry: { type: "Point", coordinates: positions[0] },
              },
              {
                type: "Feature",
                properties: { kind: "end" },
                geometry: { type: "Point", coordinates: positions[positions.length - 1] },
              },
            ],
          },
        });
        map.addLayer({
          id: "route-glow",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ee2418", "line-opacity": 0.22, "line-width": 9 },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ee2418", "line-opacity": 1, "line-width": 3.5 },
        });
        map.addLayer({
          id: "route-dots",
          type: "circle",
          source: "route",
          paint: {
            "circle-color": ["match", ["get", "kind"], "start", "#1b29c0", "#ee2418"],
            "circle-radius": 5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });

        const bounds = positions.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(positions[0], positions[0])
        );
        map.fitBounds(bounds, { padding: { top: 22, bottom: 22, left: 22, right: 22 } });
      });
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
