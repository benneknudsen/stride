/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthBackdrop } from "@/components/cobalt/AuthBackdrop";

// Feedback on the login backdrop: "ikonet indeni er ikke fuldent på dem alle" —
// the two rings were hollow 2.5px outlines while the dot and bars were solid,
// so they read as unfinished. Each ring is now a painted annulus: one path,
// fill-rule evenodd, outer circle with a genuine hole carved out (the chip
// glass shows through), and every mark shares one 70% fill alpha. These
// assertions lock that markup shape plus the untouched container/responsive
// contract, without depending on the sway animation itself.
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

const CHIP_IDS = ["red-dot", "cobalt-ring", "volume-bars", "red-ring"];

function chip(id: string): HTMLElement | null {
  return document.querySelector(`[data-chip="${id}"]`);
}

describe("AuthBackdrop", () => {
  it("renders all four decorative chips in brand order", () => {
    const { container } = render(<AuthBackdrop />);

    const chips = [...container.querySelectorAll("[data-chip]")];
    expect(chips.map((el) => el.getAttribute("data-chip"))).toEqual(CHIP_IDS);
    for (const id of CHIP_IDS) {
      expect(chip(id)?.className).toContain("cg-glass");
    }
  });

  it("keeps the middle pair hidden below sm, like the phone card contract", () => {
    render(<AuthBackdrop />);

    for (const id of ["volume-bars", "red-ring"]) {
      expect(chip(id)?.className).toContain("hidden");
      expect(chip(id)?.className).toContain("sm:flex");
    }
    for (const id of ["red-dot", "cobalt-ring"]) {
      expect(chip(id)?.className).not.toContain("hidden");
    }
  });

  it("paints both rings as filled annuli, not hollow outlines", () => {
    const { container } = render(<AuthBackdrop />);

    for (const id of ["cobalt-ring", "red-ring"]) {
      const svg = chip(id)?.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
      const path = svg?.querySelector("path");
      expect(path?.getAttribute("fill-rule")).toBe("evenodd");
      // Two closed subpaths: the outer circle and the carved hole.
      expect(path?.getAttribute("d")?.match(/z/gi)).toHaveLength(2);
      // Painted by fill only — no stroke, so no thin outline look.
      expect(svg?.hasAttribute("stroke")).toBe(false);
      expect(path?.hasAttribute("stroke")).toBe(false);
    }

    // The old ring markup (2.5px border, no fill) is gone outright.
    expect(container.querySelector('[class*="border-[2.5px]"]')).toBeNull();
    expect(container.querySelector('[class*="border-cobalt"]')).toBeNull();
    expect(container.querySelector('[class*="border-red"]')).toBeNull();
  });

  it("gives every mark the same 70% fill weight", () => {
    render(<AuthBackdrop />);

    expect(chip("red-dot")?.firstElementChild?.className).toContain("bg-red/70");
    expect(chip("cobalt-ring")?.querySelector("svg")?.getAttribute("class")).toContain(
      "fill-cobalt/70"
    );
    expect(chip("red-ring")?.querySelector("svg")?.getAttribute("class")).toContain("fill-red/70");
    expect(chip("volume-bars")?.querySelectorAll('[class*="bg-cobalt/70"]')).toHaveLength(3);
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
