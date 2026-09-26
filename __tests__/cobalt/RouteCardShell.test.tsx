/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteCardShell } from "@/components/cobalt/RouteCardShell";

// Issue #283: RouteCard (Hjem) and ActivityRouteCard (the detail page) are the
// same widget, so their markup now lives in RouteCardShell. These assertions
// cover the four things the extraction had to preserve: the no-GPS placeholder,
// the map's accessible name, the `elevation == null` chip suppression, and the
// per-surface height/measure staying at the call site.
//
// maplibre-gl is mocked at module level (as in RouteMap.test.tsx) — the real one
// wants WebGL and a network-hosted style. RouteMap itself stays real, so the
// `Rutekort for ${name}` label is asserted on the DOM it actually produces.
vi.mock("maplibre-gl", () => {
  class FakeMap {
    on = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    getSource = vi.fn(() => ({ setData: vi.fn() }));
    fitBounds = vi.fn();
    remove = vi.fn();
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return { Map: FakeMap, LngLatBounds, setWorkerUrl: vi.fn() };
});

// Silkeborg-ish [lat, lng] pairs, the way the callers pass them.
const COORDS: [number, number][] = [
  [56.1629, 10.2039],
  [56.1645, 10.2072],
  [56.1661, 10.2101],
];

function renderShell(props: Partial<Parameters<typeof RouteCardShell>[0]> = {}) {
  return render(
    <RouteCardShell
      coords={COORDS}
      km={12.34}
      elevation={87}
      name="Morgenrunden"
      minHeightClass="min-h-[260px]"
      placeholderText="Din seneste tur har ingen GPS-rute gemt, så der er intet kort at vise."
      placeholderWidthClass="max-w-[240px]"
      {...props}
    />
  );
}

describe("RouteCardShell", () => {
  it("names the map after the run it belongs to", () => {
    const { container } = renderShell();

    // The name is the only thing a screen reader gets for the map, so it has to
    // travel from the caller's `name` prop through the shell into RouteMap's
    // <figure aria-label>.
    expect(container.querySelector("figure")?.getAttribute("aria-label")).toBe(
      "Rutekort for Morgenrunden"
    );
  });

  it("renders the dashed placeholder with the surface's own copy when there is no route", () => {
    const { container, queryByRole } = renderShell({ coords: [] });

    expect(container.querySelector("figure")).toBeNull();
    expect(queryByRole("img")).toBeNull();
    expect(container.textContent).toContain(
      "Din seneste tur har ingen GPS-rute gemt, så der er intet kort at vise."
    );
    // Still a card, not a bare paragraph — the placeholder is a dashed widget.
    const dashed = container.querySelector(".border-dashed");
    expect(dashed).not.toBeNull();
    expect(dashed?.className).toContain("min-h-[260px]");
    expect(container.querySelector("p")?.className).toContain("max-w-[240px]");
  });

  it("hides the elevation chip entirely when there is no elevation", () => {
    const { queryByText } = renderShell({ elevation: null });

    // Not a blank "↑  m" — the chip is not in the DOM at all.
    expect(queryByText("↑  m")).toBeNull();
    expect(queryByText(/↑/)).toBeNull();
  });

  it("shows the elevation chip when the run carries one", () => {
    const { getByText } = renderShell({ elevation: 87 });

    expect(getByText("↑ 87 m")).toBeTruthy();
    // The distance chip beside it, in the surface's own Danish formatting.
    expect(getByText("12,3 km")).toBeTruthy();
  });
});
