"use client";

import type { FeatureCollection, LineString, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { captureError } from "@/lib/observability";

/** The dynamically imported maplibre module — `LngLatBounds` comes off it. */
type MapLibre = typeof import("maplibre-gl");

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
// `scripts/copy-maplibre-worker.mjs` re-syncs both copies on every dev/build so
// they can never drift from the installed `maplibre-gl` (#279).

function routeGeoJSON(positions: [number, number][]): FeatureCollection<LineString | Point> {
  return {
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
  };
}

function addRouteLayers(map: MapLibreMap) {
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
    // #279: the source mixes a LineString with the two Point features, and a
    // circle layer without a filter draws on *every* vertex of every geometry —
    // a dot per GPS point. Only the start/end Points should get dots, so filter
    // by geometry type.
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-color": ["match", ["get", "kind"], "start", "#1b29c0", "#ee2418"],
      "circle-radius": 5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

/** Push a route into the existing `route` source and frame it. */
function paintRoute(map: MapLibreMap, maplibregl: MapLibre, coords: [number, number][]) {
  // GeoJSON is [lng, lat]; our props are [lat, lng].
  const positions: [number, number][] = coords.map(([lat, lng]) => [lng, lat]);
  (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeGeoJSON(positions));
  const bounds = positions.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(positions[0], positions[0])
  );
  map.fitBounds(bounds, { padding: { top: 22, bottom: 22, left: 22, right: 22 } });
}

export function RouteMap({
  coords,
  label,
}: {
  coords: [number, number][];
  /** Accessible name — each caller passes the run whose route this is. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const glRef = useRef<MapLibre | undefined>(undefined);
  // Whether `load` has added the source yet — a `coords` change that lands
  // before then must wait for it instead of reaching for a source that is not
  // there.
  const readyRef = useRef(false);
  // The init path outlives the render that started it, so it reads the freshest
  // coords from here rather than closing over a single array.
  const coordsRef = useRef(coords);
  // A stable primitive, so a caller that rebuilds `coords` inline does not tear
  // the map down — while empty → non-empty still brings one up.
  const hasCoords = coords.length > 0;

  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);

  useEffect(() => {
    if (!hasCoords) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    // A new route is a new chance: clear a previous failure before retrying.
    setFailed(false);

    const teardown = () => {
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = undefined;
      glRef.current = undefined;
      delete el.dataset.cgInit;
    };

    // #279: the init used to have neither try/catch nor .catch, so a blocked
    // worker / missing WebGL / broken style became an unhandled rejection *and*
    // an invisible dead box. One failure path for both the init and the load
    // handler, and the user gets told in Danish.
    const fail = (err: unknown) => {
      captureError("routemap", err);
      teardown();
      if (!cancelled) setFailed(true);
    };

    void (async () => {
      try {
        // #279: the stylesheet loads here, next to the engine it styles, so
        // ~10 KB gzip of MapLibre CSS only ships when a map actually
        // initialises — a static top-level import bundled it into the page's CSS
        // as soon as anything imported this component. Awaited before the Map is
        // built so the canvas is never painted unstyled.
        await import("maplibre-gl/dist/maplibre-gl.css");
        const maplibregl = await import("maplibre-gl");
        if (cancelled || el.dataset.cgInit) return;
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

        const map = new maplibregl.Map({
          container: el,
          style: "https://tiles.openfreemap.org/styles/positron",
          interactive: false,
          // OpenFreeMap/OSM attribution is a license requirement — compact keeps
          // it discreet but one click away.
          attributionControl: { compact: true },
        });
        // The flag goes up *after* the constructor returned, so a throw cannot
        // strand it on a box that has no map — the e2e "map is painted" check
        // reads exactly this attribute.
        el.dataset.cgInit = "1";
        mapRef.current = map;
        glRef.current = maplibregl;

        // #279: with no error listener, a dead style or a blocked worker ended
        // as a blank grey box with no signal anywhere. Report the `error`
        // property, not the event object — captureError only serialises
        // name/message/cause, so the event itself would report "[object
        // Object]". Reporting only: a single failed tile must not throw away a
        // map that is otherwise drawing.
        map.on("error", (e) => captureError("routemap", e?.error ?? e));

        map.on("load", () => {
          if (cancelled) return;
          try {
            // The source starts empty and is filled by paintRoute, so a later
            // `coords` change is a cheap setData rather than a map rebuild.
            map.addSource("route", {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            });
            addRouteLayers(map);
            readyRef.current = true;
            const current = coordsRef.current;
            if (current.length > 0) paintRoute(map, maplibregl, current);
          } catch (err) {
            fail(err);
          }
        });
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [hasCoords]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = glRef.current;
    if (!hasCoords || !map || !maplibregl || !readyRef.current) return;
    paintRoute(map, maplibregl, coords);
  }, [coords, hasCoords]);

  // #279: `role="img"` used to sit on the mapped element, which makes the whole
  // subtree presentational — and MapLibre's attribution control (an
  // OpenFreeMap/OpenStreetMap licence requirement) lives in there. The
  // accessible name now sits on a <figure> wrapper *around* the map instead, so
  // the attribution stays reachable.
  //
  // Positioning must be inline (#276): MapLibre v6 adds an *unlayered*
  // `.maplibregl-map{position:relative}` to this container, which outranks
  // Tailwind's layered `.absolute`/`.inset-0` and collapses the box to 0px
  // (`overflow:hidden` clips the canvas away). Inline styles beat every
  // non-`!important` stylesheet rule — don't "tidy" this into classes.
  //
  // #279: a failed init used to leave a dead grey box with no explanation, so
  // say it in the same Danish the callers use for their empty-route case.
  if (failed) {
    return (
      <div className="absolute inset-0 flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-widget border border-dashed border-cobalt/25 p-6 text-center">
        <p className="max-w-[240px] text-[13px] text-ink">Rutekortet kunne ikke indlæses.</p>
      </div>
    );
  }

  return (
    <figure aria-label={label} className="absolute inset-0">
      <div
        ref={ref}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0, background: "#e9eae5" }}
      />
    </figure>
  );
}
