/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import React from "react";
import { describe, expect, test, vi } from "vitest";
import { GoalCard } from "../components/training/goal-card";
import { GOAL_LIST, GOALS, ZONE_COLOR } from "../lib/training/goals";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

describe("Training Goals Configuration", () => {
  test("GOALS object structure contains all required fields for each goal", () => {
    const goals = Object.values(GOALS);
    goals.forEach((goal) => {
      expect(goal).toHaveProperty("key");
      expect(goal).toHaveProperty("title");
      expect(goal).toHaveProperty("desc");
      expect(goal).toHaveProperty("band");
      expect(goal).toHaveProperty("fit");
      expect(goal).toHaveProperty("next");
      expect(goal).toHaveProperty("week");

      expect(Array.isArray(goal.band)).toBe(true);
      expect(goal.week.length).toBe(7);

      expect(goal.next).toHaveProperty("tag");
      expect(goal.next).toHaveProperty("type");
      expect(goal.next).toHaveProperty("distance");
      expect(goal.next).toHaveProperty("pace");
      expect(goal.next).toHaveProperty("duration");
      expect(goal.next).toHaveProperty("zone");
      expect(goal.next).toHaveProperty("why");
    });
  });

  test("ZONE_COLOR maps all 5 zones (z1-z5)", () => {
    const zones = ["z1", "z2", "z3", "z4", "z5"];
    zones.forEach((zone) => {
      expect(ZONE_COLOR).toHaveProperty(zone);
      expect(typeof ZONE_COLOR[zone as keyof typeof ZONE_COLOR]).toBe("string");
    });
    expect(Object.keys(ZONE_COLOR).length).toBe(5);
  });

  test("GOAL_LIST equals Object.values(GOALS)", () => {
    expect(GOAL_LIST).toEqual(Object.values(GOALS));
  });
});

describe("GoalCard Component", () => {
  test("renders correctly", () => {
    const mockRouter = { push: vi.fn() };
    vi.mocked(useRouter).mockReturnValue(mockRouter as unknown as ReturnType<typeof useRouter>);

    const goal = GOALS.c25k;
    render(React.createElement(GoalCard, { goal }));

    expect(screen.getByText(goal.title)).toBeDefined();
    expect(screen.getByText(goal.desc)).toBeDefined();
  });
});
