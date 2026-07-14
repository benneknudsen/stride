/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RaceDayCard } from "@/components/cobalt/plan/RaceDayCard";
import type { PlanView } from "@/lib/cobalt/plan";

// The race card is where the "never guess" rule (issue #117) becomes visible: a
// runner we can't predict for must see what would unlock their estimate, never
// the demo's 3:45 under their own race name. The view-model decides *whether*
// the card is locked (plan.test.ts); these tests pin down that the card actually
// honours it — the two states are exclusive, and neither leaks into the other.

const RACE: PlanView["race"] = {
  name: "CPH Half",
  dayLabel: "Søndag 20. september",
  dateValue: "2026-09-20",
  goalTime: "1:40",
  racePace: "4:45",
  aiEstimate: "1:38",
  lock: null,
};

describe("RaceDayCard — unlocked", () => {
  it("shows the three target numbers under their labels", () => {
    render(<RaceDayCard race={RACE} daysToRace={68} />);

    for (const value of ["1:40", "4:45", "1:38"]) {
      expect(screen.getByText(value)).toBeDefined();
    }
    for (const label of ["Måltid", "Race-pace /km", "AI-estimat"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    expect(screen.queryByTestId("race-estimate-lock")).toBeNull();
  });

  it("headlines the race itself — name, day and countdown", () => {
    render(<RaceDayCard race={RACE} daysToRace={68} />);
    expect(screen.getByText("68 dage")).toBeDefined();
    expect(screen.getByTestId("race-day-card").textContent).toContain("Søndag 20. september");
  });
});

describe("RaceDayCard — locked estimate (issue #117)", () => {
  const locked: PlanView["race"] = {
    ...RACE,
    lock: {
      reason: "runs-too-short",
      message:
        "Dine seneste ture er under 5,5 km. Løb 5,5 km eller mere, så låser vi dit race-estimat op.",
      requiredKm: 5.5,
    },
  };

  it("shows the lock's message in place of the numbers", () => {
    render(<RaceDayCard race={locked} daysToRace={68} />);

    const lock = screen.getByTestId("race-estimate-lock");
    expect(lock.textContent).toContain(locked.lock?.message);
    expect(lock.textContent).toContain("Estimat låst");
  });

  it("withholds the placeholder numbers entirely — no stranger's race time", () => {
    render(<RaceDayCard race={locked} daysToRace={68} />);

    // The view-model still carries goal/pace/estimate; a locked card must not
    // render them, nor the labels that would frame them as the runner's own.
    for (const placeholder of ["1:40", "4:45", "1:38", "Måltid", "AI-estimat"]) {
      expect(screen.queryByText(placeholder)).toBeNull();
    }
    // The race it counts down to is still the runner's own, though.
    expect(screen.getByText("68 dage")).toBeDefined();
  });

  it.each([
    "no-runs",
    "stale-runs",
    "runs-too-short",
  ] as const)("renders whatever the predictor's %s message says", (reason) => {
    const race = { ...RACE, lock: { reason, message: `Besked om ${reason}` } };
    render(<RaceDayCard race={race} daysToRace={12} />);
    expect(screen.getByTestId("race-estimate-lock").textContent).toContain(`Besked om ${reason}`);
  });
});

describe("RaceDayCard — edit affordance (issue #99)", () => {
  it("offers 'Skift race' only when the page hands it an onEdit", () => {
    const onEdit = vi.fn();
    const { unmount } = render(<RaceDayCard race={RACE} daysToRace={68} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("button", { name: "Skift race" }));
    expect(onEdit).toHaveBeenCalledOnce();

    unmount();
    render(<RaceDayCard race={RACE} daysToRace={68} />);
    expect(screen.queryByRole("button", { name: "Skift race" })).toBeNull();
  });

  it("keeps the affordance on a locked card — the wrong race is a reason to switch", () => {
    render(
      <RaceDayCard
        race={{ ...RACE, lock: { reason: "no-runs", message: "Synkronisér dine løbeture." } }}
        daysToRace={68}
        onEdit={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Skift race" })).toBeDefined();
  });
});
