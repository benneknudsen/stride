/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanHeader } from "@/components/cobalt/plan/PlanHeader";

// The header's headline is the strongest sentence on the page, and before #291 it
// named a time and nothing else ("Ét mål: under 1:55"). These pin the three
// shapes it can take: a goal with a distance, a goal the distance can't be
// attached to, and no goal at all.
//
// Since #317 the headline flips, so its text is split across aria-hidden
// character spans and the verbatim sentence now lives in the sr-only sibling —
// the heading's accessible *name*. The assertions therefore match the name,
// exactly: `toContain` cannot tell "Klar til race." from "Klar til race.." — a
// `toContain("Klar til race.")` passed on the doubled period, which is the one
// thing these exist to catch. The line break collapses to a space in the name.

const BASE = {
  planTitle: "Træningsplan · Silkeborg Halvmarathon",
  totalWeeks: 13,
  weekOfPlan: 8,
  daysToRace: 24,
  started: false,
};

/** Assert the rendered `<h1>`'s accessible name, verbatim. */
function expectHeading(name: string): void {
  expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
}

describe("PlanHeader", () => {
  it("names the distance in the goal headline", () => {
    render(<PlanHeader {...BASE} goalLabel="Mål under 1:55" distanceInline="halvmaraton" />);
    expectHeading("13 uger. Ét mål: halvmaraton under 1:55.");
  });

  it("keeps a shorthand distance as-is — there is no Danish word to lowercase", () => {
    render(<PlanHeader {...BASE} goalLabel="Mål under 45:00" distanceInline="10K" />);
    expectHeading("13 uger. Ét mål: 10K under 45:00.");
  });

  it("drops the distance for a goal none fits into, keeping the sentence shape", () => {
    // A locked estimate has no target time to hang a distance on, so the headline
    // says the one thing it has. The "Mål" → "Ét mål:" rename is the same shape
    // either way — what is missing is the distance, not the rename.
    render(<PlanHeader {...BASE} goalLabel="Mål på vej" distanceInline="halvmaraton" />);
    expectHeading("13 uger. Ét mål: på vej.");
  });

  it("falls back to the neutral headline, with one period, when there is no goal", () => {
    render(<PlanHeader {...BASE} goalLabel={null} distanceInline="halvmaraton" />);
    expectHeading("13 uger. Klar til race.");
  });
});
