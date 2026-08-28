import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/strava/sync.ts, focused on the pagination cap (issue #272).
 *
 * The sync loop previously terminated solely on Strava's pagination semantics —
 * a pathological upstream that always returned full pages would loop until the
 * function timeout. Now it stops at MAX_SYNC_PAGES, records the event via
 * captureError, and continues with what it already collected (best-effort,
 * matching the per-activity error tolerance).
 *
 * Collaborators are mocked:
 *   - @/lib/db                    (Drizzle insert chain)
 *   - @/lib/strava/client         (withTokenRefresh → getActivities)
 *   - @/lib/strava/mappers        (mapStravaSummaryToDb)
 *   - @/lib/coach/dashboard-data  (revalidateProgression)
 *   - @/lib/db/queries            (revalidateDashboardActivities)
 *   - @/lib/observability         (captureError)
 */

// biome-ignore lint/suspicious/noExplicitAny: test fixtures and fluent mocks are partial by design
type Any = any;

const mocks = vi.hoisted(() => ({
  getActivities: vi.fn(),
  mapStravaSummaryToDb: vi.fn(),
  revalidateProgression: vi.fn(),
  revalidateDashboardActivities: vi.fn(),
  captureError: vi.fn(),
  dbInsert: vi.fn(),
}));

// The insert().values().onConflictDoUpdate() chain resolves once awaited.
vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.dbInsert.mockImplementation(() => {
      const builder: Any = {
        values: () => builder,
        onConflictDoUpdate: () => Promise.resolve(),
      };
      return builder;
    }),
  },
}));
vi.mock("@/lib/strava/client", () => ({
  withTokenRefresh: vi.fn(async () => ({ getActivities: mocks.getActivities })),
}));
vi.mock("@/lib/strava/mappers", () => ({ mapStravaSummaryToDb: mocks.mapStravaSummaryToDb }));
vi.mock("@/lib/coach/dashboard-data", () => ({
  revalidateProgression: mocks.revalidateProgression,
}));
vi.mock("@/lib/db/queries", () => ({
  revalidateDashboardActivities: mocks.revalidateDashboardActivities,
}));
vi.mock("@/lib/observability", () => ({ captureError: mocks.captureError }));

import { MAX_SYNC_PAGES, syncStravaActivities } from "@/lib/strava/sync";

/** A full page of SYNC_PAGE_SIZE mappable summaries. */
function fullPage(): unknown[] {
  return Array.from({ length: 100 }, (_, i) => ({ id: i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mapStravaSummaryToDb.mockImplementation((summary: Any) => ({ mapped: summary.id }));
  mocks.getActivities.mockResolvedValue([]);
});

describe("syncStravaActivities — normal pagination", () => {
  it("stops on an empty first page and inserts nothing", async () => {
    mocks.getActivities.mockResolvedValue([]);

    const inserted = await syncStravaActivities("user-1");

    expect(inserted).toBe(0);
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.revalidateProgression).not.toHaveBeenCalled();
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("stops after a partial page (last page) and revalidates", async () => {
    mocks.getActivities
      .mockResolvedValueOnce(fullPage())
      .mockResolvedValueOnce(Array.from({ length: 7 }, (_, i) => ({ id: i })));

    const inserted = await syncStravaActivities("user-1");

    expect(inserted).toBe(107);
    expect(mocks.getActivities).toHaveBeenCalledTimes(2);
    expect(mocks.dbInsert).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateProgression).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateDashboardActivities).toHaveBeenCalledWith("user-1");
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("skips activities the mapper rejects but keeps the rest", async () => {
    mocks.getActivities.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mocks.mapStravaSummaryToDb.mockImplementation((summary: Any) => {
      if (summary.id === 2) throw new Error("unsupported activity type");
      return { mapped: summary.id };
    });

    const inserted = await syncStravaActivities("user-1");

    expect(inserted).toBe(2);
    expect(mocks.revalidateProgression).toHaveBeenCalledTimes(1);
  });
});

describe("syncStravaActivities — pagination cap (issue #272)", () => {
  it("stops at MAX_SYNC_PAGES full pages, records it, and keeps the collected rows", async () => {
    // Every page comes back full — upstream never terminates the pagination.
    mocks.getActivities.mockResolvedValue(fullPage());

    const inserted = await syncStravaActivities("user-1");

    expect(inserted).toBe(MAX_SYNC_PAGES * 100);
    expect(mocks.getActivities).toHaveBeenCalledTimes(MAX_SYNC_PAGES);
    expect(mocks.captureError).toHaveBeenCalledTimes(1);
    expect(mocks.captureError).toHaveBeenCalledWith("strava.sync.paginationCap", expect.any(Error));
    const message = mocks.captureError.mock.calls[0][1] as Error;
    expect(message.message).toContain("100-page cap");
    // Best-effort continuation: the collected activities still revalidate.
    expect(mocks.revalidateProgression).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateDashboardActivities).toHaveBeenCalledWith("user-1");
  });

  it("does not record the cap when pagination ends on its own", async () => {
    // Ends one page short of the cap: MAX_SYNC_PAGES-1 full pages, then an
    // empty one — a legitimate end Strava itself signals. (A run that fills
    // exactly MAX_SYNC_PAGES pages cannot be distinguished from pathology:
    // page MAX_SYNC_PAGES+1 is never fetched, the cap fires first.)
    mocks.getActivities.mockImplementation(async (page: number) =>
      page < MAX_SYNC_PAGES ? fullPage() : []
    );

    const inserted = await syncStravaActivities("user-1");

    expect(inserted).toBe((MAX_SYNC_PAGES - 1) * 100);
    expect(mocks.getActivities).toHaveBeenCalledTimes(MAX_SYNC_PAGES);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });
});
