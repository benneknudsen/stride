import { Param } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/strava/sync.ts — the full historical Strava sync.
 *
 * Three behaviours are covered (issues #76, #272, #338):
 *   - pagination: the loop stops on an empty/partial page and on the
 *     MAX_SYNC_PAGES cap (#272)
 *   - serialization: at most one sync per user runs at a time, while a sync
 *     for a different user is not blocked by it (#338)
 *   - write phase: every upsert takes the webhook's activity-scoped advisory
 *     lock inside the same transaction, so a webhook delivery and a sync
 *     cannot interleave on the same row (#338)
 *
 * The result tells the caller whether the history was covered completely: a
 * capped or timed-out sync reports `partial`, a sync that lost the race for
 * the user lock reports `busy` (#338).
 *
 * Collaborators are mocked:
 *   - @/lib/db                    (Drizzle transaction + insert chain, pool)
 *   - @/lib/strava/client         (withTokenRefresh → getActivities)
 *   - @/lib/strava/mappers        (mapStravaSummaryToDb)
 *   - @/lib/coach/dashboard-data  (revalidateProgression)
 *   - @/lib/db/queries            (revalidateDashboardActivities)
 *   - @/lib/observability         (captureError)
 */

// biome-ignore lint/suspicious/noExplicitAny: test fixtures and fluent mocks are partial by design
type Any = any;

const mocks = vi.hoisted(() => {
  // Session-scoped advisory locks the fake Postgres currently holds, keyed by
  // the lock id the production code asks for. Shared by every "session" so a
  // second lock attempt on the same key is refused the way Postgres refuses it.
  const heldLocks = new Set<string>();

  /** One pooled connection — a separate session, but the same lock registry. */
  const createClient = () => ({
    // The real client takes either (text, values) or a query config object.
    query: vi.fn(async (query: Any, params?: unknown[]) => {
      const text = typeof query === "string" ? query : query.text;
      const values = typeof query === "string" ? params : query.values;
      const key = (values ?? []).join(":");
      if (text.includes("pg_try_advisory_lock")) {
        if (heldLocks.has(key)) return { rows: [{ locked: false }] };
        heldLocks.add(key);
        return { rows: [{ locked: true }] };
      }
      if (text.includes("pg_advisory_unlock")) {
        heldLocks.delete(key);
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  });

  return {
    getActivities: vi.fn(),
    mapStravaSummaryToDb: vi.fn(),
    revalidateProgression: vi.fn(),
    revalidateDashboardActivities: vi.fn(),
    captureError: vi.fn(),
    // db.transaction(tx => …) — the write phase runs inside it.
    dbTransaction: vi.fn(),
    // The tx handle's methods.
    txExecute: vi.fn(),
    txInsert: vi.fn(),
    // db.insert(…) — the non-transactional insert, which the write phase
    // must not use any more.
    dbInsert: vi.fn(),
    // The pooled connection the user-scoped lock rides on.
    poolConnect: vi.fn(async () => createClient()),
    heldLocks,
    // Call order inside the write-phase transaction.
    events: [] as string[],
  };
});

// The write phase runs inside a transaction: the tx handle is the only place
// the activity lock and the upsert may live.
vi.mock("@/lib/db", () => ({
  db: {
    transaction: mocks.dbTransaction,
    insert: mocks.dbInsert,
  },
  getPool: () => ({ connect: mocks.poolConnect }),
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

import { MAX_SYNC_PAGES, SYNC_DEADLINE_MS, syncStravaActivities } from "@/lib/strava/sync";

/** A full page of SYNC_PAGE_SIZE mappable summaries. */
function fullPage(): unknown[] {
  return Array.from({ length: 100 }, (_, i) => ({ id: i }));
}

/** The activity ids a `sql` template carries, in order. */
function sqlParams(query: Any): unknown[] {
  return (query.queryChunks as Any[]).flatMap((chunk) => {
    // Drizzle inlines a numeric param as the raw number, a non-numeric one as
    // a Param wrapper.
    if (typeof chunk === "number") return [chunk];
    if (chunk instanceof Param) return [(chunk as Any).value];
    return [];
  });
}

/** A promise plus its resolver — lets a test hold a sync mid-flight. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.heldLocks.clear();
  mocks.mapStravaSummaryToDb.mockImplementation((summary: Any) => ({
    userId: "user-1",
    stravaActivityId: summary.id,
  }));
  mocks.getActivities.mockResolvedValue([]);

  // The transaction mock records the order of the calls made on its handle, so
  // a test can see that the lock and the upsert happen in the same transaction
  // and that the locks are taken in ascending activity-id order.
  mocks.events.length = 0;
  mocks.dbTransaction.mockImplementation(async (callback: Any) => {
    mocks.events.push("tx:start");
    const tx = {
      execute: async (query: Any) => {
        mocks.events.push(`lock:${sqlParams(query).join(",")}`);
      },
      insert: () => {
        mocks.events.push("upsert");
        const builder: Any = {
          values: () => builder,
          onConflictDoUpdate: () => Promise.resolve(),
        };
        return builder;
      },
    };
    try {
      return await callback(tx);
    } finally {
      mocks.events.push("tx:end");
    }
  });
});

describe("syncStravaActivities — normal pagination", () => {
  it("stops on an empty first page and inserts nothing", async () => {
    mocks.getActivities.mockResolvedValue([]);

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({ status: "complete", inserted: 0 });
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.revalidateProgression).not.toHaveBeenCalled();
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("stops after a partial page (last page) and revalidates", async () => {
    mocks.getActivities
      .mockResolvedValueOnce(fullPage())
      .mockResolvedValueOnce(Array.from({ length: 7 }, (_, i) => ({ id: i })));

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({ status: "complete", inserted: 107 });
    expect(mocks.getActivities).toHaveBeenCalledTimes(2);
    expect(mocks.dbTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateProgression).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateDashboardActivities).toHaveBeenCalledWith("user-1");
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("skips activities the mapper rejects but keeps the rest", async () => {
    mocks.getActivities.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mocks.mapStravaSummaryToDb.mockImplementation((summary: Any) => {
      if (summary.id === 2) throw new Error("unsupported activity type");
      return { userId: "user-1", stravaActivityId: summary.id };
    });

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({ status: "complete", inserted: 2 });
    expect(mocks.revalidateProgression).toHaveBeenCalledTimes(1);
  });
});

describe("syncStravaActivities — pagination cap (issue #272)", () => {
  it("stops at MAX_SYNC_PAGES full pages, records it, and keeps the collected rows", async () => {
    // Every page comes back full — upstream never terminates the pagination.
    mocks.getActivities.mockResolvedValue(fullPage());

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({
      status: "partial",
      inserted: MAX_SYNC_PAGES * 100,
      reason: "paginationCap",
    });
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

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({ status: "complete", inserted: (MAX_SYNC_PAGES - 1) * 100 });
    expect(mocks.getActivities).toHaveBeenCalledTimes(MAX_SYNC_PAGES);
    expect(mocks.captureError).not.toHaveBeenCalled();
  });
});

describe("syncStravaActivities — one sync per user (issue #338)", () => {
  it("refuses a second sync for the same user while the first one is running", async () => {
    const gate = deferred();
    mocks.getActivities.mockImplementationOnce(async () => {
      await gate.promise;
      return [];
    });

    const first = syncStravaActivities("user-1");
    // The first sync holds the user lock once it starts paging.
    await vi.waitFor(() => expect(mocks.getActivities).toHaveBeenCalledTimes(1));

    const second = await syncStravaActivities("user-1");

    expect(second).toEqual({ status: "busy", inserted: 0 });
    // The refused sync never touched Strava.
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);

    gate.resolve();
    await expect(first).resolves.toEqual({ status: "complete", inserted: 0 });
  });

  it("does not block a sync for another user", async () => {
    const gate = deferred();
    mocks.getActivities.mockImplementationOnce(async () => {
      await gate.promise;
      return [];
    });

    const first = syncStravaActivities("user-1");
    await vi.waitFor(() => expect(mocks.getActivities).toHaveBeenCalledTimes(1));

    const other = await syncStravaActivities("user-2");

    expect(other).toEqual({ status: "complete", inserted: 0 });

    gate.resolve();
    await first;
  });

  it("releases the user lock so the next sync can run", async () => {
    mocks.getActivities.mockResolvedValue([]);

    await syncStravaActivities("user-1");
    const next = await syncStravaActivities("user-1");

    expect(next).toEqual({ status: "complete", inserted: 0 });
    expect(mocks.getActivities).toHaveBeenCalledTimes(2);
  });

  it("releases the user lock when the sync throws", async () => {
    mocks.getActivities.mockRejectedValueOnce(new Error("Strava API error 500"));

    await expect(syncStravaActivities("user-1")).rejects.toThrow("Strava API error 500");

    mocks.getActivities.mockResolvedValue([]);
    const next = await syncStravaActivities("user-1");

    expect(next).toEqual({ status: "complete", inserted: 0 });
  });
});

describe("syncStravaActivities — write phase locks the rows like the webhook (issue #338)", () => {
  it("takes the activity lock inside the same transaction as the upsert", async () => {
    mocks.getActivities.mockResolvedValueOnce([{ id: 7 }, { id: 3 }]);

    await syncStravaActivities("user-1");

    expect(mocks.events).toEqual(["tx:start", "lock:3", "lock:7", "upsert", "tx:end"]);
    // The upsert must run on the transaction handle, never on db.insert.
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it("locks the activity ids in ascending order so two writers cannot deadlock", async () => {
    mocks.getActivities.mockResolvedValueOnce([{ id: 12 }, { id: 4 }, { id: 40 }]);

    await syncStravaActivities("user-1");

    expect(mocks.events).toEqual(["tx:start", "lock:4", "lock:12", "lock:40", "upsert", "tx:end"]);
  });
});

describe("syncStravaActivities — deadline (issue #338)", () => {
  it("reports a partial sync when the sync outlives its deadline", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    // The first page takes so long that the deadline passes while it is in
    // flight — the sync must stop paging and say so.
    mocks.getActivities.mockImplementationOnce(async () => {
      now += SYNC_DEADLINE_MS + 1;
      return fullPage();
    });

    const result = await syncStravaActivities("user-1");

    expect(result).toEqual({ status: "partial", inserted: 100, reason: "deadline" });
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);
    expect(mocks.captureError).toHaveBeenCalledWith("strava.sync.deadline", expect.any(Error));
  });
});
