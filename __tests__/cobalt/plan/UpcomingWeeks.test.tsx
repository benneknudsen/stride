/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpcomingWeeks } from "@/components/cobalt/plan/UpcomingWeeks";
import type { UpcomingWeek } from "@/lib/cobalt/plan";

// "Kommende uger" used to be a week number, a prose sentence and a volume —
// which left the runner to work out what to actually do (issue #291). These pin
// the concrete rows the component now prints: which calendar week, which runs,
// and how the volume moves against the week before.

function week(overrides: Partial<UpcomingWeek> = {}): UpcomingWeek {
  return {
    id: "u1",
    week: 12,
    dateLabel: "27. sep – 3. okt",
    focus: "Peak · tempo @ 4:45 /km + lang tur 18 km",
    km: 56,
    muted: false,
    weekInPhase: 3,
    phaseTotal: 3,
    deltaKm: null,
    runCount: 5,
    isRaceWeek: false,
    sessions: [
      { id: "wed", label: "Kvalitetspas", distanceKm: 12, pace: "4:45", tone: "quality" },
      { id: "sun", label: "Langtur", distanceKm: 18, pace: "5:30", tone: "long" },
      { id: "easy", label: "3 rolige ture", distanceKm: 26, pace: "5:45", tone: "easy" },
    ],
    ...overrides,
  };
}

describe("UpcomingWeeks", () => {
  it("names the calendar week the row lands in", () => {
    render(<UpcomingWeeks weeks={[week()]} />);
    expect(screen.getByText("27. sep – 3. okt")).toBeDefined();
  });

  it("prints each run the week asks for, with its distance and pace target", () => {
    render(<UpcomingWeeks weeks={[week()]} />);

    expect(screen.getByText("Kvalitetspas")).toBeDefined();
    expect(screen.getByText("Langtur")).toBeDefined();
    // The easy days are one line, not one per day — that is the point of #291.
    expect(screen.getByText("3 rolige ture")).toBeDefined();
    expect(screen.getAllByText("12 km")).toHaveLength(1);
    expect(screen.getAllByText("18 km")).toHaveLength(1);
    expect(screen.getAllByText("26 km")).toHaveLength(1);
    expect(screen.getAllByText("4:45")).toHaveLength(1);
  });

  it("omits the pace for a run that has no target", () => {
    render(
      <UpcomingWeeks
        weeks={[
          week({
            sessions: [
              { id: "sun", label: "Race", distanceKm: 21, pace: null, tone: "race" },
              {
                id: "easy",
                label: "2 rolige ture",
                distanceKm: 6,
                pace: null,
                tone: "easy",
              },
            ],
          }),
        ]}
      />
    );
    expect(screen.getByText("Race")).toBeDefined();
    // "–" is the card's no-target dash, and there must be no bare "null".
    expect(screen.getAllByText("–")).toHaveLength(2);
    expect(screen.queryByText("null")).toBeNull();
  });

  it("prints a half-km distance with a Danish comma, not a JS dot", () => {
    // 12.5 rendered raw is "12.5 km" — an English decimal separator in Danish copy.
    render(
      <UpcomingWeeks
        weeks={[
          week({
            sessions: [
              { id: "wed", label: "Kvalitetspas", distanceKm: 12.5, pace: "4:45", tone: "quality" },
            ],
          }),
        ]}
      />
    );
    expect(screen.getByText("12,5 km")).toBeDefined();
  });

  it("prints the race distance as the race card's chip does", () => {
    // Race day is a fact about the event, so the row prints the real figure —
    // "21,1 km", the same string the card's chip shows — not the plan's half-km
    // "21 km" and never a scaled fraction of it (#291).
    render(
      <UpcomingWeeks
        weeks={[
          week({
            isRaceWeek: true,
            sessions: [{ id: "sun", label: "Race", distanceKm: 21.0975, pace: null, tone: "race" }],
          }),
        ]}
      />
    );
    expect(screen.getByText("21,1 km")).toBeDefined();
  });

  it("shows the week within its phase only when the phase has more than one", () => {
    const { unmount } = render(<UpcomingWeeks weeks={[week()]} />);
    expect(screen.getByText("Uge 3 af 3")).toBeDefined();
    unmount();

    // A one-week phase has nothing to count towards.
    render(<UpcomingWeeks weeks={[week({ weekInPhase: 1, phaseTotal: 1 })]} />);
    expect(screen.queryByText("Uge 1 af 1")).toBeNull();
  });

  it("hides the counter for a week the phase no longer contains", () => {
    // Past race day getCurrentPhase() answers "peak", which puts a post-race week
    // at week 5 of a 3-week block. Printing "5 af 3" would be a lie, so the row
    // drops the counter instead.
    render(<UpcomingWeeks weeks={[week({ weekInPhase: 5, phaseTotal: 3 })]} />);
    expect(screen.queryByText("Uge 5 af 3")).toBeNull();
  });

  it("shows no delta on the first row, and a signed one after it", () => {
    const { unmount } = render(<UpcomingWeeks weeks={[week({ deltaKm: null })]} />);
    expect(screen.queryByTestId("week-delta")).toBeNull();
    expect(screen.queryByText("+0 km")).toBeNull();
    unmount();

    const { unmount: unmountUp } = render(<UpcomingWeeks weeks={[week({ deltaKm: 11 })]} />);
    expect(screen.getByTestId("week-delta").textContent).toBe("+11 km");
    unmountUp();

    render(<UpcomingWeeks weeks={[week({ deltaKm: -29 })]} />);
    expect(screen.getByTestId("week-delta").textContent).toBe("−29 km");
  });

  it("marks the race week so it can't be read as another build week", () => {
    const { unmount } = render(<UpcomingWeeks weeks={[week({ isRaceWeek: true })]} />);
    expect(screen.getByTestId("race-week-flag")).toBeDefined();
    unmount();

    render(<UpcomingWeeks weeks={[week()]} />);
    expect(screen.queryByTestId("race-week-flag")).toBeNull();
  });

  it("renders every row of the window", () => {
    render(<UpcomingWeeks weeks={[week(), week({ id: "u2", week: 13 })]} />);
    expect(screen.getAllByText("27. sep – 3. okt")).toHaveLength(2);
    expect(screen.getByText("Uge 12")).toBeDefined();
    expect(screen.getByText("Uge 13")).toBeDefined();
  });
});
