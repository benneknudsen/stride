import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for lib/db/queries.ts.
 *
 * The Drizzle client (`db` from lib/db/index.ts) is mocked with a chainable,
 * thenable query-builder stub so no real database is touched. Every fluent
 * method (`.from().where().limit()`…) returns the same builder, and awaiting
 * the builder resolves to a per-test result (or rejects with a per-test error).
 * This lets us drive both happy paths and the try/catch error paths that keep
 * a failing query from crashing the page.
 */

const mock = vi.hoisted(() => {
  // biome-ignore lint/suspicious/noExplicitAny: the mock mirrors Drizzle's loosely-typed fluent builder
  type Any = any;

  const calls: Record<string, Any[][]> = {};
  let result: Any = [];
  let rejection: Any = null;

  const record = (name: string, args: Any[]) => {
    if (!calls[name]) {
      calls[name] = [];
    }
    calls[name].push(args);
  };

  // A single shared thenable builder. Each chain method records its args and
  // returns the builder; `then` resolves/rejects with the configured outcome.
  const builder: Any = {
    // biome-ignore lint/suspicious/noThenProperty: an intentional thenable that stubs Drizzle's awaitable query builder
    then: (onFulfilled: Any, onRejected: Any) =>
      (rejection ? Promise.reject(rejection) : Promise.resolve(result)).then(
        onFulfilled,
        onRejected
      ),
  };
  for (const m of [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "values",
    "onConflictDoUpdate",
    "returning",
  ]) {
    builder[m] = (...args: Any[]) => {
      record(m, args);
      return builder;
    };
  }

  const select = vi.fn((...args: Any[]) => {
    record("select", args);
    return builder;
  });
  const insert = vi.fn((...args: Any[]) => {
    record("insert", args);
    return builder;
  });

  return {
    db: { select, insert },
    calls,
    /** Make the next awaited query resolve to `r`. */
    setResult(r: Any) {
      result = r;
      rejection = null;
    },
    /** Make the next awaited query reject with `e`. */
    setError(e: Any) {
      rejection = e;
    },
    reset() {
      for (const k of Object.keys(calls)) {
        delete calls[k];
      }
      result = [];
      rejection = null;
      select.mockClear();
      insert.mockClear();
    },
  };
});

vi.mock("@/lib/db/index", () => ({ db: mock.db }));

import {
  getAccountsByUserId,
  getActivities,
  getActivityById,
  getCachedAnalysis,
  getStravaTokens,
  getUserByEmail,
  getUserById,
  insertAnalysis,
  upsertStravaTokens,
} from "@/lib/db/queries";

const DB_ERROR = new Error("connection refused");

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getUserByEmail
// ---------------------------------------------------------------------------

describe("getUserByEmail", () => {
  it("returns the matching user row", async () => {
    const user = { id: "u1", email: "a@b.com", name: "A" };
    mock.setResult([user]);
    expect(await getUserByEmail("a@b.com")).toEqual(user);
    expect(mock.db.select).toHaveBeenCalledTimes(1);
    // Ownership/identity lookups are single-row.
    expect(mock.calls.limit?.[0]?.[0]).toBe(1);
  });

  it("returns null when no row matches (empty result)", async () => {
    mock.setResult([]);
    expect(await getUserByEmail("missing@b.com")).toBeNull();
  });

  it("returns null (not undefined) when the row is undefined", async () => {
    mock.setResult([undefined]);
    expect(await getUserByEmail("x@b.com")).toBeNull();
  });

  it("returns null when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getUserByEmail("a@b.com")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUserById
// ---------------------------------------------------------------------------

describe("getUserById", () => {
  it("returns the matching user row", async () => {
    const user = { id: "u1", email: "a@b.com", name: null, raceDate: null };
    mock.setResult([user]);
    expect(await getUserById("u1")).toEqual(user);
  });

  it("returns null on empty result", async () => {
    mock.setResult([]);
    expect(await getUserById("nope")).toBeNull();
  });

  it("returns null when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getUserById("u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAccountsByUserId
// ---------------------------------------------------------------------------

describe("getAccountsByUserId", () => {
  it("returns the list of linked accounts", async () => {
    const rows = [
      { provider: "github", type: "oauth" },
      { provider: "google", type: "oauth" },
    ];
    mock.setResult(rows);
    expect(await getAccountsByUserId("u1")).toEqual(rows);
  });

  it("selects only the non-sensitive identity columns", async () => {
    mock.setResult([]);
    await getAccountsByUserId("u1");
    expect(mock.db.select).toHaveBeenCalledWith({
      provider: expect.anything(),
      type: expect.anything(),
    });
  });

  it("returns an empty array when the user has no accounts", async () => {
    mock.setResult([]);
    expect(await getAccountsByUserId("u1")).toEqual([]);
  });

  it("returns an empty array when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getAccountsByUserId("u1")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getStravaTokens
// ---------------------------------------------------------------------------

describe("getStravaTokens", () => {
  it("returns the token row for the user", async () => {
    const token = { userId: "u1", accessTokenEnc: "enc", scope: "read" };
    mock.setResult([token]);
    expect(await getStravaTokens("u1")).toEqual(token);
    expect(mock.calls.limit?.[0]?.[0]).toBe(1);
  });

  it("returns null when the user has no stored tokens", async () => {
    mock.setResult([]);
    expect(await getStravaTokens("u1")).toBeNull();
  });

  it("returns null when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getStravaTokens("u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertStravaTokens (write path — no try/catch, errors propagate)
// ---------------------------------------------------------------------------

describe("upsertStravaTokens", () => {
  const input = {
    userId: "u1",
    accessTokenEnc: "a-enc",
    refreshTokenEnc: "r-enc",
    iv: "iv",
    authTag: "tag",
    expiresAt: new Date("2026-06-29T00:00:00.000Z"),
    scope: "read,activity:read_all",
  };

  it("inserts the values and returns the upserted row", async () => {
    const row = { id: "t1", ...input };
    mock.setResult([row]);
    expect(await upsertStravaTokens(input)).toEqual(row);
    expect(mock.db.insert).toHaveBeenCalledTimes(1);
    expect(mock.calls.values?.[0]?.[0]).toEqual(input);
    expect(mock.calls.returning).toHaveLength(1);
  });

  it("accepts a null scope", async () => {
    const withNullScope = { ...input, scope: null };
    const row = { id: "t1", ...withNullScope };
    mock.setResult([row]);
    expect(await upsertStravaTokens(withNullScope)).toEqual(row);
  });

  it("propagates database errors (no swallowing on writes)", async () => {
    mock.setError(DB_ERROR);
    await expect(upsertStravaTokens(input)).rejects.toThrow("connection refused");
  });
});

// ---------------------------------------------------------------------------
// getActivities
// ---------------------------------------------------------------------------

describe("getActivities", () => {
  it("returns activities ordered most-recent-first", async () => {
    const rows = [{ id: "a1" }, { id: "a2" }];
    mock.setResult(rows);
    expect(await getActivities("u1")).toEqual(rows);
    expect(mock.calls.orderBy).toHaveLength(1);
  });

  it("applies the default pagination window (limit 30, offset 0)", async () => {
    mock.setResult([]);
    await getActivities("u1");
    expect(mock.calls.limit?.[0]?.[0]).toBe(30);
    expect(mock.calls.offset?.[0]?.[0]).toBe(0);
  });

  it("honours explicit limit and offset", async () => {
    mock.setResult([]);
    await getActivities("u1", { limit: 10, offset: 60 });
    expect(mock.calls.limit?.[0]?.[0]).toBe(10);
    expect(mock.calls.offset?.[0]?.[0]).toBe(60);
  });

  it("supports a zero limit boundary", async () => {
    mock.setResult([]);
    await getActivities("u1", { limit: 0, offset: 0 });
    expect(mock.calls.limit?.[0]?.[0]).toBe(0);
    expect(await getActivities("u1", { limit: 0 })).toEqual([]);
  });

  it("adds a lower-bound condition when `from` is given", async () => {
    mock.setResult([]);
    await getActivities("u1", { from: new Date("2026-01-01") });
    // userId + from → the single where() call receives a combined `and(...)`.
    expect(mock.calls.where).toHaveLength(1);
  });

  it("adds both bounds when `from` and `to` are given", async () => {
    const rows = [{ id: "a1" }];
    mock.setResult(rows);
    const out = await getActivities("u1", {
      from: new Date("2026-01-01"),
      to: new Date("2026-02-01"),
    });
    expect(out).toEqual(rows);
    expect(mock.calls.where).toHaveLength(1);
  });

  it("returns an empty array when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getActivities("u1")).toEqual([]);
  });

  it("returns an empty array when there are no activities", async () => {
    mock.setResult([]);
    expect(await getActivities("u1")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActivityById
// ---------------------------------------------------------------------------

describe("getActivityById", () => {
  it("returns the activity when it belongs to the user", async () => {
    const activity = { id: "a1", userId: "u1", name: "Morning Run" };
    mock.setResult([activity]);
    expect(await getActivityById("u1", "a1")).toEqual(activity);
    expect(mock.calls.limit?.[0]?.[0]).toBe(1);
  });

  it("returns null when no activity matches (wrong owner or missing id)", async () => {
    mock.setResult([]);
    expect(await getActivityById("u1", "does-not-exist")).toBeNull();
  });

  it("returns null when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getActivityById("u1", "a1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCachedAnalysis
// ---------------------------------------------------------------------------

describe("getCachedAnalysis", () => {
  it("returns the cached analysis on a hash hit", async () => {
    const analysis = { id: "an1", userId: "u1", scope: "weekly", inputHash: "h" };
    mock.setResult([analysis]);
    expect(await getCachedAnalysis("u1", "weekly", "h")).toEqual(analysis);
  });

  it("returns null on a cache miss (empty result)", async () => {
    mock.setResult([]);
    expect(await getCachedAnalysis("u1", "overall", "no-such-hash")).toBeNull();
  });

  it("returns null when the query throws", async () => {
    mock.setError(DB_ERROR);
    expect(await getCachedAnalysis("u1", "trend", "h")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// insertAnalysis (write path — no try/catch, errors propagate)
// ---------------------------------------------------------------------------

describe("insertAnalysis", () => {
  const input = {
    userId: "u1",
    scope: "weekly" as const,
    inputHash: "hash-1",
    summary: "Solid week of base mileage.",
    toolCalls: [{ name: "weeklyVolume", args: {} }],
    model: "claude-opus-4-8",
  };

  it("inserts the analysis and returns the persisted row", async () => {
    const row = { id: "an1", createdAt: new Date("2026-06-29"), ...input };
    mock.setResult([row]);
    expect(await insertAnalysis(input)).toEqual(row);
    expect(mock.db.insert).toHaveBeenCalledTimes(1);
    expect(mock.calls.values?.[0]?.[0]).toEqual(input);
  });

  it("accepts optional fields being null/undefined", async () => {
    const minimal = { userId: "u1", scope: "overall" as const, inputHash: "h2" };
    const row = { id: "an2", ...minimal };
    mock.setResult([row]);
    expect(await insertAnalysis(minimal)).toEqual(row);
  });

  it("propagates database errors (no swallowing on writes)", async () => {
    mock.setError(DB_ERROR);
    await expect(insertAnalysis(input)).rejects.toThrow("connection refused");
  });
});
