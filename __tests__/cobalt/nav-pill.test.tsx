/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Issue #308: the top navigation is a floating pill that grows from zero on
// load (Motion server-renders the hidden state as inline styles, hence the
// jsdom style checks — same contract as the login card, #304 — and scoots away
// once the user really scrolls down, returning on the first upward scroll.
// Under prefers-reduced-motion nothing about it moves and it never hides.
//
// This lives in its own file rather than in navigation.test.tsx because that
// file's sync suite switches to vi.useFakeTimers(); the faked clock freezes
// Motion's jsdom animation driver for every later test in the same file, so a
// pill test placed after them would hang on its first animation. Keep this file
// free of fake timers.
const pathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NavBar } from "@/components/cobalt/NavBar";
import { ROUTES } from "@/lib/routes";

// jsdom has no matchMedia; Motion's useReducedMotion reads it once and
// subscribes a change listener to the MediaQueryList it first gets — so the
// stub has to be a single live object (a getter for `matches` plus working
// listener registration), not a fresh stub per test, or the later
// reduced-motion flip would never reach Motion's cached reference.
const reduceMotionListeners: Array<() => void> = [];
let reduceMotionMatches = false;
const reducedMotionQuery = {
  get matches() {
    return reduceMotionMatches;
  },
  media: "(prefers-reduced-motion)",
  onchange: null,
  addEventListener: (_event: string, listener: () => void) => {
    reduceMotionListeners.push(listener);
  },
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
};
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => reducedMotionQuery,
});

function setPrefersReducedMotion(matches: boolean) {
  reduceMotionMatches = matches;
  for (const listener of reduceMotionListeners) listener();
}

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  fireEvent.scroll(window);
}

describe("floating nav pill (#308)", () => {
  const pill = () => screen.getByTestId("nav-pill");

  beforeEach(() => {
    pathname.mockReturnValue(ROUTES.HOME);
    setPrefersReducedMotion(false);
  });

  test("starts hidden and ends visible", async () => {
    render(<NavBar />);

    expect(pill().style.opacity).toBe("0");

    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });
  });

  test("hides on a real downward scroll and returns on the first upward one", async () => {
    render(<NavBar />);
    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });

    // Accumulated downward travel past the reference thresholds (y > 150,
    // delta > 120) — the reference's own scroll listener.
    scrollTo(400);
    await waitFor(() => expect(pill().style.opacity).toBe("0"), { timeout: 3000 });

    scrollTo(100);
    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 3000 });
  });

  test("prefers-reduced-motion: visible at once and it never hides", async () => {
    setPrefersReducedMotion(true);
    render(<NavBar />);

    await waitFor(() => expect(pill().style.opacity).toBe("1"), { timeout: 1000 });

    scrollTo(900);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pill().style.opacity).toBe("1");
  });
});
