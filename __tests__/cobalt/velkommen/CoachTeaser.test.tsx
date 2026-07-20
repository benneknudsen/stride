/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CoachTeaser } from "@/components/cobalt/velkommen/CoachTeaser";

// jsdom has no matchMedia; the component reads it once on mount, so a plain
// stub choosing the prefers-reduced-motion answer is all it needs.
function setPrefersReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches, media: query }),
  });
}

// jsdom has no IntersectionObserver either. This mock records every instance so
// a test can drive visibility by hand: `emit(true)` fires an intersecting entry,
// `emit(false)` an off-screen one, mirroring the browser scrolling the card in
// and out of view.
type IOInstance = {
  emit: (isIntersecting: boolean) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let observers: IOInstance[] = [];

function installIntersectionObserverMock() {
  observers = [];
  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    constructor(private cb: IntersectionObserverCallback) {
      observers.push({
        observe: this.observe,
        disconnect: this.disconnect,
        emit: (isIntersecting: boolean) => {
          this.cb(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
        },
      });
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
}

describe("CoachTeaser (#121, #162)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installIntersectionObserverMock();
  });

  afterEach(() => {
    // Flush any timers a mid-animation test left scheduled, inside act() so the
    // final setTyped doesn't warn about an unwrapped update.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("renders the honest mono label and the analyzed run's numbers", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    expect(screen.getByText(/AI-coachen · Eksempel på analyse/i)).toBeTruthy();
    // The meta line pins the script to the demo fixture it replays.
    expect(screen.getByText(/Tempo Tuesday · 10,0 km · 4:27 \/km/i)).toBeTruthy();
  });

  test("does not start the typewriter until the card is visible", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    // Card mounted but never intersected: still the transparent sizing copy,
    // no animated overlay, and advancing time does nothing.
    expect(screen.queryByTestId("coach-cursor")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("coach-cursor")).toBeNull();

    // Scroll into view → the typewriter starts.
    act(() => {
      observers[0]?.emit(true);
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("coach-cursor")).toBeTruthy();
    expect(screen.getByText(/absorberer belastningen/).className).toContain("opacity-0");
  });

  test("pauses the typewriter while the card is off-screen", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    // Type a few characters while visible.
    act(() => {
      observers[0]?.emit(true);
      vi.advanceTimersByTime(600 + 26 * 5);
    });
    const overlay = () => screen.getByTestId("coach-cursor").parentElement;
    const typedWhileVisible = overlay()?.textContent ?? "";
    expect(typedWhileVisible.length).toBeGreaterThan(0);

    // Scroll off-screen: advancing time must not type any further.
    act(() => {
      observers[0]?.emit(false);
      vi.advanceTimersByTime(5000);
    });
    expect(overlay()?.textContent ?? "").toBe(typedWhileVisible);
  });

  test("stops after a single playthrough and disconnects the observer", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    act(() => {
      observers[0]?.emit(true);
      // More than enough time to type the whole script once.
      vi.advanceTimersByTime(600 + 26 * 1200 + 1000);
    });

    // The animated overlay is gone (phase went static), the full script is now
    // opaque, and the observer was torn down so no more work happens.
    expect(screen.queryByTestId("coach-cursor")).toBeNull();
    const script = screen.getByText(/absorberer belastningen/);
    expect(script.className).not.toContain("opacity-0");
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  test("shows the full analysis statically under prefers-reduced-motion", () => {
    setPrefersReducedMotion(true);
    render(<CoachTeaser />);

    const script = screen.getByText(/absorberer belastningen/);
    expect(script.className).not.toContain("opacity-0");
    expect(script.textContent).toContain("10,0 km på 44:30");
    // No animation: the typewriter overlay never mounts.
    expect(screen.queryByTestId("coach-cursor")).toBeNull();
  });
});
