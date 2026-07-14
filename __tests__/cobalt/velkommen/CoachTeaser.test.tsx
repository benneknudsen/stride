/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CoachTeaser } from "@/components/cobalt/velkommen/CoachTeaser";

// jsdom has no matchMedia; the component reads it once on mount, so a plain
// stub choosing the prefers-reduced-motion answer is all it needs.
function setPrefersReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches, media: query }),
  });
}

describe("CoachTeaser (#121)", () => {
  test("renders the honest mono label and the analyzed run's numbers", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    expect(screen.getByText(/AI-coachen · Eksempel på analyse/i)).toBeTruthy();
    // The meta line pins the script to the demo fixture it replays.
    expect(screen.getByText(/Tempo Tuesday · 10,0 km · 4:27 \/km/i)).toBeTruthy();
  });

  test("starts the typewriter after mount when motion is allowed", () => {
    setPrefersReducedMotion(false);
    render(<CoachTeaser />);

    // The animated overlay (with its blinking cursor) exists, and the sizing
    // copy of the script is transparent — the visible text is the typed one.
    expect(screen.getByTestId("coach-cursor")).toBeTruthy();
    expect(screen.getByText(/absorberer belastningen/).className).toContain("opacity-0");
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
