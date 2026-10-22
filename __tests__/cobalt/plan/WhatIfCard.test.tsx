/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatIfCard } from "@/components/cobalt/plan/WhatIfCard";
import type { PlanView } from "@/lib/cobalt/plan";

// The "hvad hvis" card (issue #340) makes the projection explorable: the runner
// points the predictor at another distance and reads what their current basis
// reaches there, and how far their own goal sits from it. The view-model decides
// the numbers (plan.test.ts); these tests pin down that the card honours them —
// it switches distance, keeps the numbers honest (a locked distance shows its
// lock, never another distance's number) and stays operable without a mouse.

const SCENARIOS: PlanView["scenarios"] = [
  {
    distanceKm: 5,
    label: "5K",
    distanceKmLabel: "5 km",
    timeSeconds: 1250,
    estimate: "20:50",
    paceSecPerKm: 250,
    paceRange: "3:50–4:10",
    confidence: "high",
    confidenceLabel: "Høj",
    defaultGoalSeconds: 1260,
    lock: null,
    isOwnRace: false,
  },
  {
    distanceKm: 10,
    label: "10K",
    distanceKmLabel: "10 km",
    timeSeconds: 2500,
    estimate: "41:40",
    paceSecPerKm: 250,
    paceRange: "3:50–4:10",
    confidence: "medium",
    confidenceLabel: "Middel",
    defaultGoalSeconds: 2700,
    lock: null,
    isOwnRace: true,
  },
  {
    distanceKm: 21.0975,
    label: "Halvmarathon",
    distanceKmLabel: "21,1 km",
    timeSeconds: 5700,
    estimate: "1:35",
    paceSecPerKm: 270,
    paceRange: "4:10–4:30",
    confidence: "medium",
    confidenceLabel: "Middel",
    defaultGoalSeconds: 5700,
    lock: null,
    isOwnRace: false,
  },
  {
    distanceKm: 42.195,
    label: "Marathon",
    distanceKmLabel: "42,2 km",
    timeSeconds: null,
    estimate: null,
    paceSecPerKm: null,
    paceRange: null,
    confidence: null,
    confidenceLabel: null,
    defaultGoalSeconds: null,
    lock: {
      reason: "runs-too-short",
      message:
        "Dine seneste ture er under 10,5 km. Løb 10,5 km eller mere, så låser vi dit race-estimat op.",
      requiredKm: 10.5,
    },
    isOwnRace: false,
  },
];

function renderCard(scenarios: PlanView["scenarios"] = SCENARIOS) {
  return render(<WhatIfCard scenarios={scenarios} signedIn />);
}

describe("WhatIfCard — distance choice", () => {
  it("opens on the runner's own distance", () => {
    renderCard();
    expect(screen.getByTestId("whatif-estimate").textContent).toBe("41:40");
    expect(screen.getByRole("button", { name: /10K · 10 km/ }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("switches the shown prognosis when another distance is picked", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /5K · 5 km/ }));
    expect(screen.getByTestId("whatif-estimate").textContent).toBe("20:50");
    expect(screen.getByRole("button", { name: /5K · 5 km/ }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: /10K · 10 km/ }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  it("keeps every choice a real button with a visible focus ring", () => {
    // Native buttons are keyboard-reachable and activate on Enter/Space; the
    // shared cg-interactive utility carries the visible focus ring.
    renderCard();
    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.className).toContain("cg-interactive");
    }
  });

  it("shows the lock instead of numbers for a distance the predictor cannot reach", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Marathon · 42,2 km/ }));
    expect(screen.getByTestId("whatif-lock").textContent).toContain("10,5 km");
    expect(screen.queryByTestId("whatif-estimate")).toBeNull();
  });
});

describe("WhatIfCard — goal and gap", () => {
  it("says how far the goal sits from the prognosis", () => {
    // The 10K goal is 45:00 against a 41:40 prognosis — 200 s slower, 20 s/km.
    renderCard();
    expect(screen.getByTestId("whatif-gap").textContent).toBe(
      "Du har 20 sek/km i hus — målet er langsommere end din prognose."
    );
    expect(screen.getByTestId("whatif-gap-duration").textContent).toContain("3:20");
  });

  it("re-reads the gap when the goal is adjusted", () => {
    renderCard();
    fireEvent.change(screen.getByLabelText("Måltid"), { target: { value: "40" } });
    // 40:00 against 41:40 — the goal is now 100 s faster, 10 s/km.
    expect(screen.getByTestId("whatif-gap").textContent).toBe(
      "Målet kræver 10 sek/km hurtigere end din prognose."
    );
  });

  it("offers the goal as a real number field", () => {
    renderCard();
    const input = screen.getByLabelText("Måltid");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("type")).toBe("number");
    expect(input.className).toContain("cg-interactive");
  });

  it("clamps a goal beyond the plausible range", () => {
    // A number field accepts whatever is typed — the card must not turn a stray
    // keystroke into a 38-hour goal and a nonsense pace.
    renderCard();
    fireEvent.change(screen.getByLabelText("Måltid"), { target: { value: "5000" } });
    expect((screen.getByLabelText("Måltid") as HTMLInputElement).value).toBe("1440");
  });

  it("lets the field stand empty and falls back on blur", () => {
    // The field must be clearable — a goal the runner is halfway through
    // typing is not yet a goal.
    renderCard();
    const input = screen.getByLabelText("Måltid") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe("45");
  });
});

describe("WhatIfCard — demo plan", () => {
  it("shows no numbers when the runner has no data of their own", () => {
    renderCard([]);
    expect(screen.getByTestId("whatif-empty").textContent).toContain("Vælg din egen race");
    expect(screen.queryByTestId("whatif-estimate")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
