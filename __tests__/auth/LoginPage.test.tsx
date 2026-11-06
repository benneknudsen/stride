/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hasReducedMotionListener } from "motion-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";
import LoginPage from "@/app/(auth)/login/page";
import { DEMO_HOME_ROUTE } from "@/lib/routes";

// Issue #304: the login page is the real entry point. These tests pin the
// CTA hierarchy (Strava primary and first in tab order, demo a real tracked
// secondary CTA through the LoginLink pattern) and the Motion entrance
// contract (the card is opaque from the first render so LCP never waits on
// hydration, and the transform settles afterwards; under prefers-reduced-motion
// every duration is 0 and no hidden state remains).
//
// jsdom has no matchMedia; Motion's useReducedMotion reads it and subscribes,
// so the stub needs the full MediaQueryList shape, not just `matches`.
function setPrefersReducedMotion(matches: boolean) {
  // Motion caches the media query at module scope and only initialises it once.
  // Reset that guard so each render reads the preference this test sets,
  // regardless of which test rendered before it.
  hasReducedMotionListener.current = false;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches,
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

// Lenis (issue #307) auto-resizes through ResizeObserver, which jsdom does not
// ship either — a no-op stand-in keeps the provider's real mount path running.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe("LoginPage — CTA hierarchy and entrance (#304)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPrefersReducedMotion(false);
  });

  test("demo is a tracked secondary CTA pointing at the demo dashboard", () => {
    render(<LoginPage />);

    const demo = screen.getByRole("link", { name: /Udforsk demoen/i });
    expect(demo.getAttribute("href")).toBe(DEMO_HOME_ROUTE);

    // jsdom cannot navigate to the href and logs a console error if the anchor
    // click goes through; the capture listener marks the event's default as
    // handled while the link's own onClick (the tracked event) still runs.
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", stopNavigation, { capture: true });
    fireEvent.click(demo);
    document.removeEventListener("click", stopNavigation, { capture: true });

    expect(track).toHaveBeenCalledWith("demo_åbnet");
  });

  test("Strava is the first tab stop and the demo CTA the second", () => {
    render(<LoginPage />);

    const focusables = Array.from(document.querySelectorAll("button, a[href]"));
    expect(focusables[0]?.textContent).toContain("Log ind med Strava");
    expect(focusables[1]).toBe(screen.getByRole("link", { name: /Udforsk demoen/i }));
  });

  test("the h1 title is the FlipText component (#306)", () => {
    render(<LoginPage />);

    // The heading keeps its accessible one-string name while the visible copy
    // is the animated, aria-hidden FlipText markup.
    const heading = screen.getByRole("heading", { level: 1, name: "Log ind" });
    const chars = heading.querySelectorAll("[data-char]");
    expect(chars.length).toBe("Log ind".replace(" ", "").length);
    for (const char of chars) {
      expect(char.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  test("the card is opaque from the first render so LCP does not wait", () => {
    render(<LoginPage />);

    const card = screen.getByTestId("login-card");
    // The entrance is transform-only (scale/y): Motion's server-rendered
    // initial state must never hide the card behind opacity 0, and an omitted
    // opacity style is fully opaque.
    expect(Number(card.style.opacity || 1)).toBe(1);
  });

  test("prefers-reduced-motion: card stays opaque and the entrance has duration 0", async () => {
    setPrefersReducedMotion(true);
    render(<LoginPage />);

    const card = screen.getByTestId("login-card");
    expect(Number(card.style.opacity || 1)).toBe(1);

    // The reduced branch sets every duration to 0, so the transform settles on
    // the first frame — well before the normal 700 ms entrance would. A card
    // still running the normal animation would fail this short timeout.
    await waitFor(() => expect(card.style.transform).toBe("none"), { timeout: 500 });

    // No hidden state is left behind on the card or any staggered row.
    for (const element of [card, ...card.querySelectorAll<HTMLElement>("[style]")]) {
      expect(Number(element.style.opacity || 1)).toBe(1);
    }
    expect(screen.getByRole("button", { name: /Log ind med Strava/i })).toBeTruthy();
  });
});

describe("LoginPage — shared CTA affordances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPrefersReducedMotion(false);
  });

  // Both CTAs must carry the one shared hover utility (`cg-cta`, defined in
  // app/globals.css) so neither can silently drift into its own animation.
  test("both login CTAs carry the shared cg-cta hover utility", () => {
    render(<LoginPage />);

    const strava = screen.getByRole("button", { name: /Log ind med Strava/i });
    const demo = screen.getByRole("link", { name: /Udforsk demoen/i });
    expect(strava.classList.contains("cg-cta")).toBe(true);
    expect(demo.classList.contains("cg-cta")).toBe(true);
  });

  // The pointer cursor comes from one base rule in app/globals.css — no CTA
  // may carry its own `cursor-pointer`, and the superseded hover classes must
  // not come back and compete with cg-cta.
  test("no login CTA carries its own cursor class or a superseded hover effect", () => {
    render(<LoginPage />);

    const ctas = [
      screen.getByRole("button", { name: /Log ind med Strava/i }),
      screen.getByRole("link", { name: /Udforsk demoen/i }),
    ];
    for (const cta of ctas) {
      expect(cta.classList.contains("cursor-pointer")).toBe(false);
      expect(cta.className).not.toMatch(/hover:opacity-90|hover:bg-white/);
    }
  });
});
