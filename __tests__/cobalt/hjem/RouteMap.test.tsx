/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteMap } from "@/components/cobalt/hjem/RouteMap";

// Issue #282: the "Rute" card header stayed visible through both the 0-height
// map bug (#276) and the dot-per-vertex bug (#279), so a unit test has to assert
// what MapLibre is actually told to draw. maplibre-gl is mocked at module level:
// it wants WebGL and a network-hosted style that neither jsdom nor a unit test
// should provide.
const mocks = vi.hoisted(() => ({
  setWorkerUrl: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  fitBounds: vi.fn(),
  remove: vi.fn(),
  onLoad: undefined as (() => void) | undefined,
  // Keeps the container MapLibre received so a test can inspect its inline
  // layout contract after render (#276).
  container: undefined as HTMLElement | undefined,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options: { container: HTMLElement }) {
      mocks.container = options.container;
    }
    on = vi.fn((event: string, handler: () => void) => {
      if (event === "load") mocks.onLoad = handler;
    });
    addSource = mocks.addSource;
    addLayer = mocks.addLayer;
    fitBounds = mocks.fitBounds;
    remove = mocks.remove;
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return { Map: FakeMap, LngLatBounds, setWorkerUrl: mocks.setWorkerUrl };
});

// Silkeborg-ish [lat, lng] pairs, the way the callers pass them.
const COORDS: [number, number][] = [
  [56.1629, 10.2039],
  [56.1645, 10.2072],
  [56.1661, 10.2101],
];

function layerById(id: string) {
  return mocks.addLayer.mock.calls.find(([layer]) => layer.id === id)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onLoad = undefined;
  mocks.container = undefined;
});

describe("RouteMap", () => {
  it("adds the route source and draws the three route layers once the map loads", async () => {
    render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.onLoad).toBeDefined());
    mocks.onLoad?.();

    expect(mocks.setWorkerUrl).toHaveBeenCalledWith("/maplibre-gl-worker.mjs");
    expect(mocks.addSource).toHaveBeenCalledWith(
      "route",
      expect.objectContaining({ type: "geojson" })
    );

    // Props are [lat, lng]; GeoJSON is [lng, lat].
    const source = mocks.addSource.mock.calls[0][1];
    expect(source.data.features[0].geometry.coordinates).toEqual([
      [10.2039, 56.1629],
      [10.2072, 56.1645],
      [10.2101, 56.1661],
    ]);

    expect(mocks.addLayer).toHaveBeenCalledTimes(3);
    expect(layerById("route-glow")).toMatchObject({ type: "line", source: "route" });
    expect(layerById("route-line")).toMatchObject({ type: "line", source: "route" });
    expect(mocks.fitBounds).toHaveBeenCalled();
  });

  it("guards #276: hands MapLibre a container positioned via inline styles", async () => {
    const { container } = render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.container).toBeDefined());
    const mapContainer = mocks.container;
    if (!mapContainer) throw new Error("MapLibre never received the RouteMap container");

    // Regression guard for #276: maplibre-gl v6 adds an *unlayered*
    // `.maplibregl-map{position:relative}` to the container, which outranks
    // Tailwind's layered `.absolute`/`.inset-0` and collapses the box to 0px.
    // Only inline styles beat an unlayered stylesheet rule, so assert the
    // style attribute — not the class list — or a "tidy it into classes"
    // regression slips through again.
    expect(container.contains(mapContainer)).toBe(true);
    expect(mapContainer.style.position).toBe("absolute");
    expect(mapContainer.style.inset).toBe("0px");
  });

  it("filters route-dots down to the Point features only", async () => {
    render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.onLoad).toBeDefined());
    mocks.onLoad?.();

    // Regression guard for #279: the "route" source mixes a LineString with the
    // two Point features, and a circle layer without this filter paints a dot on
    // every vertex of the line.
    expect(layerById("route-dots")).toMatchObject({
      type: "circle",
      source: "route",
      filter: ["==", ["geometry-type"], "Point"],
    });
  });

  it("never touches MapLibre when there are no coordinates", async () => {
    render(<RouteMap coords={[]} label="Ruten mangler" />);

    await Promise.resolve();
    expect(mocks.setWorkerUrl).not.toHaveBeenCalled();
    expect(mocks.addLayer).not.toHaveBeenCalled();
  });
});
