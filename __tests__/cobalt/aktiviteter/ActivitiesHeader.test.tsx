/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivitiesHeader } from "@/components/cobalt/aktiviteter/ActivitiesHeader";

// Issue #317: the two-line activities headline flips as one title. The line
// break lives inside the animation, so the accessible name must still be the
// whole sentence, with the break collapsed to a space.

describe("ActivitiesHeader — flip title (#317)", () => {
  it("exposes the two-line headline as one accessible string", () => {
    render(
      <ActivitiesHeader
        periodLabel="Sidste 90 dage"
        totalKm={120.5}
        totalRuns={30}
        totalSeconds={40000}
        started={false}
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Alle dine ture, samlet ét sted." })
    ).toBeTruthy();
  });

  it("animates the headline through aria-hidden character spans", () => {
    const { container } = render(
      <ActivitiesHeader
        periodLabel="Sidste 90 dage"
        totalKm={120.5}
        totalRuns={30}
        totalSeconds={40000}
        started={false}
      />
    );

    const chars = container.querySelectorAll("h1 [data-char]");
    expect(chars.length).toBeGreaterThan(0);
    for (const char of chars) {
      expect(char.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
