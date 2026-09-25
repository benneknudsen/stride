import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1", name: "Test Runner" } }),
}));

vi.mock("@/lib/db/queries", () => ({
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
import type { DashboardActivity } from "@/lib/db/queries";
import { getDashboardActivities } from "@/lib/db/queries";

type AnyElement = ReactElement<Record<string, unknown>>;

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

    expect(computeCoachDashboard).toHaveBeenCalledTimes(1);
    const dashboard = vi.mocked(computeCoachDashboard).mock.results[0]?.value;

    const section = findElement(tree, isNextWorkoutSection);
    expect(section).not.toBeNull();

    const sectionFn = section?.type as (props: unknown) => Promise<unknown>;
    await sectionFn(section?.props);

    expect(computeCoachDashboard).toHaveBeenCalledTimes(1);
    expect(section?.props.dashboard).toBe(dashboard);
  });
});

describe("CoachPage — issue #195 (Neon timestamp string bug)", () => {
  it("handles activities with Date startDate (normalized from DB string)", async () => {
    const startDate = new Date("2026-07-15T08:00:00.000Z");
    const mockActivities: DashboardActivity[] = [
      {
        id: "a1",
        name: "Morning Run",
        type: "Run",
        source: "strava",
        startDate,
        distance: 5000,
        movingTime: 1800,
        averageSpeed: 2.78,
        averageHeartrate: 145,
        averageCadence: 170,
        totalElevationGain: 50,
        hrZones: null,
        summaryPolyline: null,
      },
    ];

    vi.mocked(getDashboardActivities).mockResolvedValueOnce(mockActivities);

    const tree = await CoachPage();
    expect(tree).not.toBeNull();
  });

  it("handles activities with string startDate (raw DB value in prod)", async () => {
    const mockActivities = [
      {
        id: "a1",
        name: "Morning Run",
        type: "Run",
        source: "strava",
        startDate: "2026-07-15T08:00:00.000Z",
        distance: 5000,
        movingTime: 1800,
        averageSpeed: 2.78,
        averageHeartrate: 145,
        averageCadence: 170,
        totalElevationGain: 50,
        hrZones: null,
        summaryPolyline: null,
      },
    ] as unknown as DashboardActivity[];

    vi.mocked(getDashboardActivities).mockResolvedValueOnce(mockActivities);

    const tree = await CoachPage();
    expect(tree).not.toBeNull();
  });
});
