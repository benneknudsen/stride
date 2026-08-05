/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpcomingWeeks } from "@/components/cobalt/plan/UpcomingWeeks";
import type { UpcomingWeek } from "@/lib/cobalt/plan";

// The widget's job (issue #247) is to be specific: each week must show when it
// runs, what it asks for, and how the volume moves. The view-model decides the
// numbers (plan.test.ts); these tests pin down that the card actually renders
// them instead of collapsing back to a single vague line.

const WEEKS: UpcomingWeek[] = [
  {
    id: "u1",
    week: 9,
    dateRange: "18.–24. aug",
    phaseLabel: "Sharpen",
    phaseProgress: "uge 2 af 3",
    runCount: 5,
    sessions: [
      { id: "long", label: "Langtur", distance: "18 km", pace: "5:30 /km", tone: "long" },
      { id: "tempo", label: "Tempo", distance: "10 km", pace: "4:45 /km", tone: "quality" },
      { id: "easy", label: "3 rolige ture", distance: "26 km", pace: "5:45 /km", tone: "easy" },
    ],
    km: 30,
    deltaKm: 3,
    muted: false,
    isRaceWeek: false,
  },
  {
    id: "u2",
    week: 10,
    dateRange: "25.–31. aug",
    phaseLabel: "Nedtrapning",
    phaseProgress: "uge 1 af 1",
    runCount: 2,
    sessions: [
      { id: "race", label: "Race", distance: "21,1 km", pace: null, tone: "race" },
      { id: "easy", label: "Rolig tur", distance: "6 km", pace: "5:45 /km", tone: "easy" },
    ],
    km: 27,
    deltaKm: -3,
    muted: true,
    isRaceWeek: true,
  },
];

describe("UpcomingWeeks", () => {
  it("dates each week and places it in its training block", () => {
    render(<UpcomingWeeks weeks={WEEKS} />);
    expect(screen.getByText("Uge 9")).toBeDefined();
    expect(screen.getByText("18.–24. aug")).toBeDefined();
    expect(screen.getByText("Sharpen · uge 2 af 3 · 5 løb")).toBeDefined();
  });

  it("names every run with its distance and pace target", () => {
    render(<UpcomingWeeks weeks={WEEKS} />);
    for (const label of ["Langtur", "Tempo", "3 rolige ture"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    expect(screen.getByText("18 km")).toBeDefined();
    expect(screen.getByText("4:45 /km")).toBeDefined();
  });

  it("shows how the volume moves week over week", () => {
    render(<UpcomingWeeks weeks={WEEKS} />);
    expect(screen.getByText("+3 km")).toBeDefined();
    expect(screen.getByText("−3 km")).toBeDefined();
    // …and the block total, so the three rows read as one stretch of training.
    expect(screen.getByText("2 uger · 57 km")).toBeDefined();
  });

  it("flags the race week", () => {
    render(<UpcomingWeeks weeks={WEEKS} />);
    expect(screen.getByText("Race-uge")).toBeDefined();
    expect(screen.getByText("Race")).toBeDefined();
  });

  it("stays quiet when a week holds its volume — no ±0 noise", () => {
    render(<UpcomingWeeks weeks={[{ ...WEEKS[0], deltaKm: 0 }]} />);
    expect(screen.getByText("30 km")).toBeDefined(); // the volume itself still shows
    expect(screen.queryByText(/^[+−]0 km$/)).toBeNull();
  });
});
