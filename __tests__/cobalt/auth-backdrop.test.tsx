/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthBackdrop } from "@/components/cobalt/AuthBackdrop";

// The login backdrop carries four painted running/training marks: a stopwatch,
// a route pin, a running shoe and a heart-rate pulse. They replaced the old
// abstract dot/rings/bars because those did not read as running. These
// assertions lock the new motif order, the solid-fill markup (no outline
// strokes), the shared 70% brand alpha, and the untouched container and
// responsive contract.
//
// jsdom has no matchMedia; Motion's useReducedMotion reads it and subscribes,
// so the stub carries the full MediaQueryList shape (as in LoginPage.test.tsx).
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const CHIP_IDS = ["stopwatch", "route-pin", "running-shoe", "heart-rate"];

const FILL_BY_CHIP: Record<string, string> = {
  stopwatch: "fill-red/70",
  "route-pin": "fill-cobalt/70",
  "running-shoe": "fill-cobalt/70",
  "heart-rate": "fill-red/70",
};

function chip(id: string): HTMLElement | null {
  return document.querySelector(`[data-chip="${id}"]`);
}

describe("AuthBackdrop", () => {
  it("renders all four decorative chips in training-motif order", () => {
    const { container } = render(<AuthBackdrop />);

    const chips = [...container.querySelectorAll("[data-chip]")];
    expect(chips.map((el) => el.getAttribute("data-chip"))).toEqual(CHIP_IDS);
    for (const id of CHIP_IDS) {
      expect(chip(id)?.className).toContain("cg-glass");
    }
  });

  it("keeps the middle pair hidden below sm, like the phone card contract", () => {
    render(<AuthBackdrop />);

    for (const id of ["running-shoe", "heart-rate"]) {
      expect(chip(id)?.className).toContain("hidden");
      expect(chip(id)?.className).toContain("sm:flex");
    }
    for (const id of ["stopwatch", "route-pin"]) {
      expect(chip(id)?.className).not.toContain("hidden");
    }
  });

  it("paints every motif as a solid filled SVG, not an outline", () => {
    render(<AuthBackdrop />);

    for (const id of CHIP_IDS) {
      const svg = chip(id)?.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("class")).toContain("size-6");
      expect(svg?.hasAttribute("stroke")).toBe(false);
      expect(svg?.getAttribute("fill")).not.toBe("none");

      const paths = [...(svg?.querySelectorAll("path") ?? [])];
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.hasAttribute("stroke")).toBe(false);
        expect(path.getAttribute("fill")).not.toBe("none");
      }
    }
  });

  it("gives every mark the same 70% fill weight", () => {
    render(<AuthBackdrop />);

    for (const id of CHIP_IDS) {
      expect(chip(id)?.querySelector("svg")?.getAttribute("class")).toContain(FILL_BY_CHIP[id]);
    }
  });

  it("keeps each 24px mark inside the 48px mobile / 64px desktop chip", () => {
    render(<AuthBackdrop />);

    for (const id of CHIP_IDS) {
      expect(chip(id)?.className).toContain("size-12");
      expect(chip(id)?.className).toContain("md:size-16");
    }
  });

  it("stays decorative to assistive tech and click-through", () => {
    const { container } = render(<AuthBackdrop />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.className).toContain("pointer-events-none");
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("overflow-hidden");
  });
});
