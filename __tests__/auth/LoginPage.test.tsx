/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track } from "@vercel/analytics";
import LoginPage from "@/app/(auth)/login/page";
import { DEMO_HOME_ROUTE } from "@/lib/routes";

// Issue #304: the login page is the real entry point. These tests pin the
// CTA hierarchy (Strava primary and first in tab order, demo a real tracked
// secondary CTA through the LoginLink pattern) and the Motion entrance
// contract (starts hidden, ends visible, and under prefers-reduced-motion
// nothing stays hidden).
//
// jsdom has no matchMedia; Motion's useReducedMotion reads it and subscribes,
// so the stub needs the full MediaQueryList shape, not just `matches`.
function setPrefersReducedMotion(matches: boolean) {
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

  test("the card starts hidden and ends visible", async () => {
    render(<LoginPage />);

    const card = screen.getByTestId("login-card");
    expect(card.style.opacity).toBe("0");

    await waitFor(() => expect(card.style.opacity).toBe("1"), { timeout: 3000 });
  });

  test("prefers-reduced-motion: nothing starts hidden", async () => {
    setPrefersReducedMotion(true);
    render(<LoginPage />);

    const card = screen.getByTestId("login-card");
    await waitFor(() => expect(card.style.opacity).toBe("1"), { timeout: 1000 });
    expect(screen.getByRole("button", { name: /Log ind med Strava/i })).toBeTruthy();
  });
});
