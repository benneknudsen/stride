/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RaceDateDialog } from "@/components/cobalt/plan/RaceDateDialog";

/**
 * The race picker dialog (issue #99, #238) with the goal-entry fix from issue
 * #239: on iPhone the numeric keypad has no colon key, so `1:45:00` / `5:00`
 * could not be typed. The dialog now offers distance-aware tappable suggestions
 * (the primary mobile path) and auto-inserts colons for digits-only entry
 * ("14500" → "1:45:00"), while still validating through parseClock. Everything
 * the dialog reaches out to — the save action, analytics, the router, the pure
 * phase engine — is mocked; these tests pin down the goal UI itself.
 */

const mocks = vi.hoisted(() => ({
  saveRacePlan: vi.fn(),
  track: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/actions/race", () => ({
  saveRacePlan: mocks.saveRacePlan,
}));

vi.mock("@vercel/analytics", () => ({
  track: mocks.track,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

// getCurrentPhase is pure, but stubbing it keeps the advisory lines quiet and
// deterministic (same phase in and out → no phase-shift note to trip over).
vi.mock("@/lib/coach/engine", () => ({
  getCurrentPhase: () => "Opbygning",
}));

const BASE_PROPS = {
  open: true as const,
  onClose: vi.fn(),
  currentDateValue: "2026-09-20",
  currentName: "",
  currentDistanceKm: 21.0975, // Halvmaraton
  currentGoalTimeSeconds: null,
};

function renderDialog(overrides: Partial<typeof BASE_PROPS> = {}) {
  const onClose = vi.fn();
  const props = { ...BASE_PROPS, onClose, ...overrides };
  const utils = render(<RaceDateDialog {...props} />);
  return { onClose, ...utils };
}

describe("RaceDateDialog — goal entry (issue #239)", () => {
  beforeEach(() => {
    mocks.saveRacePlan.mockReset().mockResolvedValue({ ok: true });
    mocks.track.mockReset();
    mocks.refresh.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides the goal field entirely in 'Intet mål' mode", () => {
    renderDialog();
    // Default mode is "Intet mål" — no goal input, no suggestions.
    expect(screen.queryByLabelText("Sluttid")).toBeNull();
    expect(screen.queryByLabelText("Målpace")).toBeNull();
    expect(screen.queryByRole("group", { name: "Forslag til mål" })).toBeNull();
  });

  it("offers distance-aware time suggestions that update when the distance changes", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Måltid" }));

    // Halvmaraton preset → half-marathon finish times.
    expect(screen.getByRole("button", { name: "1:45:00" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "50:00" })).toBeNull();

    // Switching the distance re-derives the suggestions for that distance.
    fireEvent.click(screen.getByRole("button", { name: "10K" }));
    expect(screen.getByRole("button", { name: "50:00" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "1:45:00" })).toBeNull();
  });

  it("offers generic pace suggestions in 'Målpace' mode", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Målpace" }));
    for (const pace of ["4:30", "5:00", "5:30", "6:00"]) {
      expect(screen.getByRole("button", { name: pace })).toBeDefined();
    }
  });

  it("fills the goal value and updates the derived line when a suggestion is tapped", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Måltid" }));
    fireEvent.click(screen.getByRole("button", { name: "1:45:00" }));

    expect((screen.getByLabelText("Sluttid") as HTMLInputElement).value).toBe("1:45:00");
    // 6300 s over 21.0975 km ≈ 4:59 /km — the derived pace follows the goal.
    expect(screen.getByText(/≈ 4:59 \/km/)).toBeDefined();
  });

  it("auto-inserts colons for digits-only entry so an iOS keypad works", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Måltid" }));
    const input = screen.getByLabelText("Sluttid") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "14500" } });
    expect(input.value).toBe("1:45:00");

    // Pace mode formats to m:ss.
    fireEvent.click(screen.getByRole("button", { name: "Målpace" }));
    const pace = screen.getByLabelText("Målpace") as HTMLInputElement;
    fireEvent.change(pace, { target: { value: "500" } });
    expect(pace.value).toBe("5:00");
  });

  it("still validates manual colon entry via parseClock and shows the Danish error", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Måltid" }));
    const input = screen.getByLabelText("Sluttid") as HTMLInputElement;

    // A colon the user typed is respected — and 99 seconds is out of range.
    fireEvent.change(input, { target: { value: "9:99" } });
    expect(input.value).toBe("9:99");

    fireEvent.click(screen.getByRole("button", { name: "Gem race" }));
    expect(screen.getByText(/Ugyldig måltid/)).toBeDefined();
    expect(mocks.saveRacePlan).not.toHaveBeenCalled();
  });

  it("submits the resolved distance and goal time, then refreshes and closes", async () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Måltid" }));
    fireEvent.click(screen.getByRole("button", { name: "1:45:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem race" }));

    await waitFor(() =>
      expect(mocks.saveRacePlan).toHaveBeenCalledWith({
        raceDate: "2026-09-20",
        raceName: undefined,
        raceDistanceKm: 21.0975,
        goalTimeSeconds: 6300,
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.track).toHaveBeenCalledWith("racedato_sat");
    expect(mocks.track).toHaveBeenCalledWith("racemaal_sat");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("converts a goal pace to a finish time on submit (issue #238)", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Målpace" }));
    fireEvent.click(screen.getByRole("button", { name: "5:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem race" }));

    // 300 s/km × 21.0975 km = 6329.25 → 6329 s.
    await waitFor(() =>
      expect(mocks.saveRacePlan).toHaveBeenCalledWith(
        expect.objectContaining({ raceDistanceKm: 21.0975, goalTimeSeconds: 6329 })
      )
    );
  });
});
