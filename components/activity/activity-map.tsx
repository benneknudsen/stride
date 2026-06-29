"use client";

/**
 * Renders a Strava summary polyline as a self-contained SVG route map.
 *
 * No tiling/map provider is used (and none is installed) — instead the encoded
 * polyline is decoded to lat/lng points, projected into a fixed viewBox, and
 * drawn as a single path. This keeps the route fully client-rendered with no
 * external requests or API keys.
 */

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;
const PADDING = 16;

/**
 * Decode a Google/Strava encoded polyline into `[lat, lng]` pairs.
 * See https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/** Project lat/lng points into the SVG viewBox, preserving aspect ratio. */
function projectPoints(points: [number, number][]): string {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const innerWidth = VIEW_WIDTH - PADDING * 2;
  const innerHeight = VIEW_HEIGHT - PADDING * 2;
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;
  const scale = Math.min(innerWidth / spanLng, innerHeight / spanLat);

  // Center the route within the viewBox after scaling.
  const offsetX = (innerWidth - spanLng * scale) / 2;
  const offsetY = (innerHeight - spanLat * scale) / 2;

  return points
    .map(([lat, lng]) => {
      const x = PADDING + offsetX + (lng - minLng) * scale;
      // Flip latitude: SVG y grows downward, latitude grows upward (north).
      const y = PADDING + offsetY + (maxLat - lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ActivityMap({ summaryPolyline }: { summaryPolyline: string | null }) {
  if (!summaryPolyline) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-border bg-card-2 text-sm text-muted">
        No route data available
      </div>
    );
  }

  const points = decodePolyline(summaryPolyline);

  if (points.length < 2) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-2xl border border-border bg-card-2 text-sm text-muted">
        No route data available
      </div>
    );
  }

  const polylinePoints = projectPoints(points);
  const start = polylinePoints.split(" ")[0];
  const end = polylinePoints.split(" ").at(-1);
  const [startX, startY] = start.split(",");
  const [endX, endY] = (end ?? start).split(",");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card-2">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Activity route map"
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="#C6F432"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={startX} cy={startY} r={5} fill="#33E0CB" />
        <circle cx={endX} cy={endY} r={5} fill="#FF5B41" />
      </svg>
    </div>
  );
}
