import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the Garmin push/ping webhook (app/api/garmin/webhook).
 *
 * The token check (timing-safe, header-or-query, fails closed) and the SSRF
 * allowlist (lib/garmin/config, left real) run for real. Side-effecting deps
 * are mocked:
 *   - @/lib/db                    (Drizzle client + transaction)
 *   - @/lib/garmin/client         (withGarminTokenRefresh → fetchCallback)
 *   - @/lib/garmin/mappers        (mapGarminActivityToDb)
 *   - @/lib/coach/dashboard-data  (revalidateProgression)
 *   - @/lib/db/queries            (deleteGarminTokens, revalidateDashboardActivities)
 */

const SECRET = "garmin-webhook-secret";

const { dbMock, clientMock, mappersMock, queriesMock, coachMock } = vi.hoisted(() => {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's loosely-typed fluent builder
  type Any = any;

  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  // Resolve findUserByGarminId by Garmin user id; unmapped ids → no user.
  let userByGarminId: Record<string, Any> = {};
  let nextGarminIdInWhere: string | null = null;

  const builder: Any = {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable stubbing Drizzle's awaitable builder
    then: (onFulfilled: Any, onRejected: Any) => {
      const id = nextGarminIdInWhere;
      nextGarminIdInWhere = null;
      const row = id && userByGarminId[id] ? [userByGarminId[id]] : [];
      return Promise.resolve(row).then(onFulfilled, onRejected);
    },
    from: () => builder,
    // The route filters on eq(users.garminUserId, garminUserId); capture the value.
    where: (cond: Any) => {
      // drizzle's eq() builds an opaque node; the route only ever compares the
      // garmin id here, so pull it back out of our own marker if present.
      if (cond?.__garminId) nextGarminIdInWhere = cond.__garminId;
      return builder;
    },
    limit: () => builder,
    values: () => builder,
    onConflictDoUpdate: () => builder,
  };

  const select = vi.fn(() => {
    bump("select");
    return builder;
  });
  const insert = vi.fn(() => {
    bump("insert");
    return builder;
  });
  const execute = vi.fn(() => Promise.resolve());
  const transaction = vi.fn(async (cb: Any) => {
    bump("transaction");
    return cb({ execute, insert });
  });

  return {
    dbMock: {
      db: { select, insert, transaction, execute },
      calls,
      setUsers(map: Record<string, Any>) {
        userByGarminId = map;
      },
      reset() {
        for (const k of Object.keys(calls)) delete calls[k];
        userByGarminId = {};
        nextGarminIdInWhere = null;
        for (const fn of [select, insert, execute, transaction]) fn.mockClear();
      },
    },
    clientMock: { fetchCallback: vi.fn() },
    mappersMock: { mapGarminActivityToDb: vi.fn() },
    queriesMock: { deleteGarminTokens: vi.fn(), revalidateDashboardActivities: vi.fn() },
    coachMock: { revalidateProgression: vi.fn() },
  };
});

// Make eq(users.garminUserId, id) carry the id through to our where() capture.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    // biome-ignore lint/suspicious/noExplicitAny: test shim over drizzle's eq
    eq: (_col: any, value: any) => ({ __garminId: value }),
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock.db }));
vi.mock("@/lib/garmin/client", () => ({
  withGarminTokenRefresh: vi.fn(async () => ({ fetchCallback: clientMock.fetchCallback })),
}));
vi.mock("@/lib/garmin/mappers", () => ({
  mapGarminActivityToDb: mappersMock.mapGarminActivityToDb,
}));
vi.mock("@/lib/coach/dashboard-data", () => ({
  revalidateProgression: coachMock.revalidateProgression,
}));
vi.mock("@/lib/db/queries", () => ({
  deleteGarminTokens: queriesMock.deleteGarminTokens,
  revalidateDashboardActivities: queriesMock.revalidateDashboardActivities,
}));

import { POST } from "@/app/api/garmin/webhook/route";

// biome-ignore lint/suspicious/noExplicitAny: test fixtures are partial by design
type Any = any;

type PostOpts = { token?: string; header?: string; rawBody?: string };

function postRequest(body: unknown, opts: PostOpts = {}): NextRequest {
  const url = new URL("http://localhost/api/garmin/webhook");
  if (opts.token !== undefined) url.searchParams.set("token", opts.token);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.header !== undefined) headers["x-garmin-webhook-token"] = opts.header;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

function summary(over: Partial<Any> = {}): Any {
  return {
    userId: "garmin-1",
    summaryId: "sum-1",
    startTimeInSeconds: 1_700_000_000,
    durationInSeconds: 3000,
    activityType: "RUNNING",
    ...over,
  };
}

beforeEach(() => {
  dbMock.reset();
  clientMock.fetchCallback.mockReset();
  mappersMock.mapGarminActivityToDb
    .mockReset()
    .mockImplementation((s: Any, userId: string) => ({ userId, garminSummaryId: s.summaryId }));
  queriesMock.deleteGarminTokens.mockReset();
  queriesMock.revalidateDashboardActivities.mockReset();
  coachMock.revalidateProgression.mockReset();
  vi.stubEnv("GARMIN_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ===========================================================================
// Token verification
// ===========================================================================

describe("token verification", () => {
  it("rejects a POST with no token (401)", async () => {
    const res = await POST(postRequest({ activities: [] }));
    expect(res.status).toBe(401);
    expect(dbMock.db.select).not.toHaveBeenCalled();
  });

  it("rejects a POST with the wrong token (401)", async () => {
    const res = await POST(postRequest({ activities: [] }, { token: "nope" }));
    expect(res.status).toBe(401);
  });

  it("rejects when GARMIN_WEBHOOK_SECRET is unset (fails closed, 401)", async () => {
    vi.stubEnv("GARMIN_WEBHOOK_SECRET", "");
    const res = await POST(postRequest({ activities: [] }, { token: SECRET }));
    expect(res.status).toBe(401);
  });

  it("accepts the secret via the ?token= query string (200)", async () => {
    const res = await POST(postRequest({ activities: [] }, { token: SECRET }));
    expect(res.status).toBe(200);
  });

  it("accepts the secret via the x-garmin-webhook-token header (200)", async () => {
    const res = await POST(postRequest({ activities: [] }, { header: SECRET }));
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Body parsing
// ===========================================================================

describe("body parsing", () => {
  it("returns 400 on a malformed JSON body", async () => {
    const res = await POST(postRequest(null, { token: SECRET, rawBody: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("acks an empty payload without ingesting", async () => {
    const res = await POST(postRequest({ activities: [] }, { token: SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbMock.db.transaction).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Deregistrations
// ===========================================================================

describe("deregistrations", () => {
  it("drops tokens for a known athlete who revoked access", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    const res = await POST(
      postRequest({ deregistrations: [{ userId: "garmin-1" }] }, { token: SECRET })
    );
    expect(res.status).toBe(200);
    expect(queriesMock.deleteGarminTokens).toHaveBeenCalledWith("u1");
  });

  it("ignores a deregistration for an unknown athlete", async () => {
    dbMock.setUsers({});
    const res = await POST(
      postRequest({ deregistrations: [{ userId: "ghost" }] }, { token: SECRET })
    );
    expect(res.status).toBe(200);
    expect(queriesMock.deleteGarminTokens).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Push (inline summaries)
// ===========================================================================

describe("push events (inline summaries)", () => {
  it("ingests inline summaries and revalidates", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    const res = await POST(postRequest({ activities: [summary()] }, { token: SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ingested: 1 });
    expect(dbMock.db.transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.db.insert).toHaveBeenCalledTimes(1);
    expect(coachMock.revalidateProgression).toHaveBeenCalledTimes(1);
    expect(queriesMock.revalidateDashboardActivities).toHaveBeenCalledWith("u1");
  });

  it("acks (200) a summary for an unknown athlete without ingesting", async () => {
    dbMock.setUsers({}); // garmin-1 not linked
    const res = await POST(postRequest({ activities: [summary()] }, { token: SECRET }));
    expect(res.status).toBe(200);
    expect(dbMock.db.transaction).not.toHaveBeenCalled();
    expect(coachMock.revalidateProgression).not.toHaveBeenCalled();
  });

  it("collapses duplicate summaryIds in one push to a single upsert batch", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    const dup = summary({ summaryId: "sum-1" });
    const res = await POST(postRequest({ activities: [dup, dup] }, { token: SECRET }));
    expect(res.status).toBe(200);
    // Deduped to one row → still one insert statement, ingested count 1.
    expect(await res.json()).toEqual({ ok: true, ingested: 1 });
    expect(dbMock.db.insert).toHaveBeenCalledTimes(1);
  });

  it("returns 500 (so Garmin retries) when the upsert throws", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    dbMock.db.transaction.mockRejectedValueOnce(new Error("deadlock"));
    const res = await POST(postRequest({ activities: [summary()] }, { token: SECRET }));
    expect(res.status).toBe(500);
    expect(coachMock.revalidateProgression).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Ping (callbackURL) — SSRF allowlist
// ===========================================================================

describe("ping events (callbackURL, SSRF allowlist)", () => {
  it("follows an allowlisted callbackURL, fetches summaries, and ingests them", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    clientMock.fetchCallback.mockResolvedValueOnce([summary({ summaryId: "fetched-1" })]);
    const ping = { userId: "garmin-1", callbackURL: "https://apis.garmin.com/wellness-api/x" };

    const res = await POST(postRequest({ activities: [ping] }, { token: SECRET }));

    expect(res.status).toBe(200);
    expect(clientMock.fetchCallback).toHaveBeenCalledWith("https://apis.garmin.com/wellness-api/x");
    expect(await res.json()).toEqual({ ok: true, ingested: 1 });
  });

  it("drops a ping with a non-allowlisted callbackURL and never fetches it", async () => {
    dbMock.setUsers({ "garmin-1": { id: "u1" } });
    const ping = { userId: "garmin-1", callbackURL: "https://evil.example.com/steal" };

    const res = await POST(postRequest({ activities: [ping] }, { token: SECRET }));

    // Bad URL is not transient — ack it, do not retry, and do not fetch.
    expect(res.status).toBe(200);
    expect(clientMock.fetchCallback).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, ingested: 0 });
  });
});
