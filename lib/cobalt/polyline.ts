// Google encoded-polyline decoder — Strava stores each activity's route as a
// `summary_polyline` string (drizzle/schema.ts → activities.summaryPolyline),
// and RouteMap wants [lat, lng] pairs. Precision 5 (1e-5 degrees), the format
// Strava emits.
//
// Malformed input yields whatever prefix decoded cleanly rather than throwing:
// a detail page must never crash on a bad route string.

/** Decode a precision-5 encoded polyline into `[lat, lng]` pairs. */
export function decodePolyline(encoded: string | null | undefined): [number, number][] {
  if (!encoded) return [];

  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    // Each coordinate is a zig-zag-encoded delta, split into 5-bit chunks with
    // the high bit marking "more chunks follow".
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0) return coords;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0) return coords;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / 1e5, lng / 1e5]);
  }

  return coords;
}
