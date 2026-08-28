import { describe, expect, test } from "vitest";
import { GOALS } from "../lib/training/goals";

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
});
