import { describe, expect, it } from "vitest";
import { buildHomeView, type HomeActivityLike } from "@/lib/cobalt/hjem";
import { decodePolyline } from "@/lib/cobalt/polyline";

// A short encoded route (precision 5) — the same format Strava's
// `summary_polyline` uses.
const POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

function run(overrides: Partial<HomeActivityLike> = {}): HomeActivityLike {
  return {
    id: "a1",
    name: "Aftentur",
    type: "Run",
    startDate: new Date("2026-07-13T18:00:00"),
    distance: 10_000,
    movingTime: 3_000,
    averageSpeed: 3.33,
    averageHeartrate: 148,
    averageCadence: 88,
    totalElevationGain: 42,
    ...overrides,
  };
}

describe("buildHomeView route (issue #114)", () => {
  it("draws the newest run's own decoded polyline", () => {
    const view = buildHomeView([run({ summaryPolyline: POLYLINE })]);

    expect(view.routeCoords).toEqual(decodePolyline(POLYLINE));
    expect(view.routeCoords.length).toBeGreaterThan(0);
  });

  it("reads the newest run, not an older one with a route", () => {
    const view = buildHomeView([
      run({ id: "new", summaryPolyline: null }),
      run({ id: "old", summaryPolyline: POLYLINE }),
    ]);

    expect(view.routeCoords).toEqual([]);
  });

  it("draws nothing for a live run without GPS", () => {
    const view = buildHomeView([run({ summaryPolyline: null })]);

    expect(view.routeCoords).toEqual([]);
  });

  it("keeps a stand-in route for the demo fixtures", () => {
    // The fixtures carry no polyline, but demo mode still shows a map.
    expect(buildHomeView().routeCoords.length).toBeGreaterThan(0);
  });

  it("keeps the stand-in route when a user's activities are all cross-training", () => {
    const view = buildHomeView([run({ type: "Ride", summaryPolyline: POLYLINE })]);

    expect(view.routeCoords.length).toBeGreaterThan(0);
    expect(view.routeCoords).not.toEqual(decodePolyline(POLYLINE));
  });
});
