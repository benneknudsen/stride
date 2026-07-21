import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #167: the coach page must run computeCoachDashboard exactly once per
// request. It used to call it twice with identical args — once for the workout
// card (NextWorkoutSection) and once for the coach console. We spy on the engine
// entry point, render the whole page tree (including the suspended workout
// section), and assert a single call whose result is shared as a prop.

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1", name: "Test Runner" } }),
}));

vi.mock("@/lib/db/queries", () => ({
  // Empty rows → the page falls back to the demo fixtures, so no DB is touched.
  getDashboardActivities: vi.fn().mockResolvedValue([]),
  getRacePlan: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/coach/dashboard-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coach/dashboard-data")>();
  return {
    ...actual,
    computeCoachDashboard: vi.fn(actual.computeCoachDashboard),
  };
});

import CoachPage from "@/app/(app)/dashboard/coach/page";
import { computeCoachDashboard } from "@/lib/coach/dashboard-data";

type AnyElement = ReactElement<Record<string, unknown>>;

/** Depth-first search of a React element tree for the first node matching. */
function findElement(node: unknown, predicate: (el: AnyElement) => boolean): AnyElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("type" in node)) return null;
  const el = node as AnyElement;
  if (predicate(el)) return el;
  return findElement(el.props?.children, predicate);
}

const isNextWorkoutSection = (el: AnyElement) =>
  typeof el.type === "function" && el.type.name === "NextWorkoutSection";

describe("CoachPage — issue #167", () => {
  beforeEach(() => {
    vi.mocked(computeCoachDashboard).mockClear();
  });

  it("computes the coach dashboard exactly once per request", async () => {
    const tree = await CoachPage();

    // The console has already consumed the dashboard during the page render.
    expect(computeCoachDashboard).toHaveBeenCalledTimes(1);
    const dashboard = vi.mocked(computeCoachDashboard).mock.results[0]?.value;

    // Render the suspended workout section too — before the fix it re-ran the
    // engine here; now it must reuse the shared result without recomputing.
    const section = findElement(tree, isNextWorkoutSection);
    expect(section).not.toBeNull();

    const sectionFn = section?.type as (props: unknown) => Promise<unknown>;
    await sectionFn(section?.props);

    expect(computeCoachDashboard).toHaveBeenCalledTimes(1);
    // The section received the very object the single computation produced.
    expect(section?.props.dashboard).toBe(dashboard);
  });
});
