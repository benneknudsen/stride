/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvgPaceRing } from "@/components/cobalt/hjem/AvgPaceRing";
import { buildHomeView } from "@/lib/cobalt/hjem";

// Issue #124: the pace widget must be part of the demo dashboard. buildHomeView
// with all-default arguments is exactly the view a visitor on `?demo=1` gets,
// so these assertions cover the demo path end to end: the view-model always
// carries a pace, and the ring renders it.

describe("demo pace widget (issue #124)", () => {
  it("buildHomeView (demo) always returns a pace label", () => {
    const view = buildHomeView();

    expect(view.avgPaceLabel).not.toBe("");
    // paceSecondsToClock format — "m:ss".
    expect(view.avgPaceLabel).toMatch(/^\d+:\d{2}$/);
  });

  it("AvgPaceRing renders the demo view's pace label", () => {
    const view = buildHomeView();

    render(
      <AvgPaceRing
        paceLabel={view.avgPaceLabel}
        fraction={view.avgPaceFraction}
        deltaLabel={view.avgPaceDeltaLabel}
        started
      />
    );

    expect(screen.getByText(view.avgPaceLabel)).toBeDefined();
    expect(screen.getByText("Snit-pace")).toBeDefined();
  });
});
