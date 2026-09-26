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
  setData: vi.fn(),
  fitBounds: vi.fn(),
  remove: vi.fn(),
  // Constructor call count: a `coords` change must never build a second Map.
  mapCtor: vi.fn(),
  captureError: vi.fn(),
  // Set by a test to make `new Map(...)` throw the way a missing WebGL context
  // or a blocked worker does.
  constructorError: null as Error | null,
  onLoad: undefined as (() => void) | undefined,
  onError: undefined as ((event: unknown) => void) | undefined,
  // Keeps the container MapLibre received so a test can inspect its inline
  // layout contract after render (#276).
  container: undefined as HTMLElement | undefined,
}));

vi.mock("@/lib/observability", () => ({ captureError: mocks.captureError }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options: { container: HTMLElement }) {
      mocks.mapCtor();
      mocks.container = options.container;
      if (mocks.constructorError) throw mocks.constructorError;
    }
    on = vi.fn((event: string, handler: (event?: unknown) => void) => {
      if (event === "load") mocks.onLoad = handler as () => void;
      if (event === "error") mocks.onError = handler as (event: unknown) => void;
    });
    addSource = mocks.addSource;
    addLayer = mocks.addLayer;
    getSource = vi.fn((id: string) => (id === "route" ? { setData: mocks.setData } : undefined));
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

// A different route shape, so a `setData` payload can be told apart from the
// first one. Same length on purpose: the test is about identity, not geometry.
const COORDS_B: [number, number][] = [
  [56.1629, 10.2039],
  [56.1651, 10.2081],
  [56.1677, 10.2109],
];

function layerById(id: string) {
  return mocks.addLayer.mock.calls.find(([layer]) => layer.id === id)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onLoad = undefined;
  mocks.onError = undefined;
  mocks.container = undefined;
  mocks.constructorError = null;
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
    const source = mocks.setData.mock.calls[0][0];
    expect(source.features[0].geometry.coordinates).toEqual([
      [10.2039, 56.1629],
      [10.2072, 56.1645],
      [10.2101, 56.1661],
    ]);
    // The start/end Point features the dot layer filters down to.
    expect(source.features[1]).toMatchObject({
      properties: { kind: "start" },
      geometry: { type: "Point", coordinates: [10.2039, 56.1629] },
    });
    expect(source.features[2]).toMatchObject({
      properties: { kind: "end" },
      geometry: { type: "Point", coordinates: [10.2101, 56.1661] },
    });

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

  it("adds the route source empty so painting a route is always a setData", async () => {
    render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.onLoad).toBeDefined());
    mocks.onLoad?.();

    // #279: the source starts empty and the `load` handler fills it, so a
    // `coords` change can never need an addSource on a map that already has one.
    expect(mocks.addSource).toHaveBeenCalledWith("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  });

  it("repaints via setData instead of rebuilding the map when coords change", async () => {
    const { rerender } = render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.onLoad).toBeDefined());
    mocks.onLoad?.();
    expect(mocks.setData).toHaveBeenCalledTimes(1);

    rerender(<RouteMap coords={COORDS_B} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.setData).toHaveBeenCalledTimes(2));
    expect(mocks.setData.mock.calls[1][0].features[0].geometry.coordinates).toEqual([
      [10.2039, 56.1629],
      [10.2081, 56.1651],
      [10.2109, 56.1677],
    ]);

    // #279: a new array identity used to tear the whole Map down and build
    // another one — expensive and it flickers.
    expect(mocks.mapCtor).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    // The new route has to be framed too, not just redrawn.
    expect(mocks.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("keeps the attribution exposed: the accessible name is not on role=img", async () => {
    const { container } = render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.container).toBeDefined());
    const mapContainer = mocks.container;
    const named = container.querySelector("[aria-label]");
    if (!mapContainer || !named) throw new Error("RouteMap rendered no named map container");

    // #279: `role="img"` makes everything inside presentational, which hid
    // MapLibre's attribution control (an OpenFreeMap/OpenStreetMap licence
    // requirement) from assistive tech.
    expect(named.getAttribute("role")).not.toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Rutekort for demoturen");
    // The name must not be *on* the mapped element (nor on the element MapLibre
    // fills with its canvas and attribution) — that is the arrangement that hid
    // the licence links in the first place.
    expect(named).not.toBe(mapContainer);
    expect(mapContainer.getAttribute("role")).toBeNull();
    expect(mapContainer.getAttribute("aria-label")).toBeNull();

    // ...while the #276 inline-positioning contract still holds on the element
    // MapLibre actually receives.
    expect(mapContainer.style.position).toBe("absolute");
    expect(mapContainer.style.inset).toBe("0px");
  });

  it("reports a failed init through captureError and swaps in the Danish fallback", async () => {
    mocks.constructorError = new Error("WebGL unavailable");
    const { container } = render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    // #279: a dead map used to leave a blank #e9eae5 box with no signal at all.
    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(
        "routemap",
        expect.objectContaining({ message: "WebGL unavailable" })
      )
    );
    expect(container.textContent).toContain("Rutekortet kunne ikke indlæses.");
  });

  it("leaves no stale data-cg-init flag behind when init fails", async () => {
    mocks.constructorError = new Error("WebGL unavailable");
    const { container } = render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    // Wait for the constructor to have run and its rejection to settle first —
    // otherwise this passes just because init has not reached the flag yet.
    await waitFor(() => expect(mocks.mapCtor).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The flag used to be set *before* the constructor ran, so a throw stranded
    // it on a box that never had a map — which is what the e2e "map is painted"
    // assertion reads.
    expect(container.querySelector("[data-cg-init]")).toBeNull();
  });

  it("reports MapLibre's error events by their error property, not the raw event", async () => {
    render(<RouteMap coords={COORDS} label="Rutekort for demoturen" />);

    await waitFor(() => expect(mocks.onError).toBeDefined());
    const event = { error: new Error("Failed to load style"), type: "error" };
    mocks.onError?.(event);

    // captureError only serialises name/message/cause, so handing it the whole
    // event object would report "[object Object]".
    expect(mocks.captureError).toHaveBeenCalledWith("routemap", event.error);
    expect(mocks.captureError.mock.calls[0][1]).not.toBe(event);
  });
});
