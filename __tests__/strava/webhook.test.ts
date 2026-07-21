import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the Strava webhook route (app/api/strava/webhook).
 *
 * The security-critical parts — HMAC X-Hub-Signature-256 verification and the
 * GET subscription handshake — run for real; the test signs bodies with the
 * same client secret the route verifies against. Everything with a side effect
 * is mocked:
 *   - @/lib/db                    (Drizzle client + transaction)
 *   - @/lib/strava/client         (withTokenRefresh → getActivity)
 *   - @/lib/strava/mappers        (mapStravaToDb)
 *   - @/lib/coach/dashboard-data  (revalidateProgression)
 *   - @/lib/db/queries            (revalidateDashboardActivities)
 */

const SECRET = "strava-client-secret";
const VERIFY_TOKEN = "strava-verify-token";

const { dbMock, clientMock, mappersMock, queriesMock, coachMock } = vi.hoisted(() => {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors Drizzle's loosely-typed fluent builder
  type Any = any;

  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  // Writes (insert/delete/upsert) go through this thenable builder; their
  // resolved value is ignored, so it just resolves empty. Resolving the owning
  // user no longer touches `db` — it is mocked on @/lib/db/queries below.
  const builder: Any = {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable stubbing Drizzle's awaitable builder
    then: (onFulfilled: Any, onRejected: Any) => Promise.resolve([]).then(onFulfilled, onRejected),
  };
  for (const m of ["from", "where", "limit", "values", "onConflictDoUpdate", "set", "returning"]) {
    builder[m] = () => builder;
  }

  const insert = vi.fn(() => {
    bump("insert");
    return builder;
  });
  const del = vi.fn(() => {
    bump("delete");
    return builder;
  });
  const execute = vi.fn(() => Promise.resolve());
  const transaction = vi.fn(async (cb: Any) => {
    bump("transaction");
    return cb({ execute, insert, delete: del });
  });

  return {
    dbMock: {
      db: { insert, delete: del, transaction, execute },
      calls,
      reset() {
        for (const k of Object.keys(calls)) delete calls[k];
        for (const fn of [insert, del, execute, transaction]) fn.mockClear();
      },
    },
    clientMock: { getActivity: vi.fn() },
    mappersMock: { mapStravaToDb: vi.fn() },
    queriesMock: { getUserByStravaAthleteId: vi.fn(), revalidateDashboardActivities: vi.fn() },
    coachMock: { revalidateProgression: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock.db }));
vi.mock("@/lib/strava/client", () => ({
  withTokenRefresh: vi.fn(async () => ({ getActivity: clientMock.getActivity })),
}));
vi.mock("@/lib/strava/mappers", () => ({ mapStravaToDb: mappersMock.mapStravaToDb }));
vi.mock("@/lib/coach/dashboard-data", () => ({
  revalidateProgression: coachMock.revalidateProgression,
}));
vi.mock("@/lib/db/queries", () => ({
  getUserByStravaAthleteId: queriesMock.getUserByStravaAthleteId,
  revalidateDashboardActivities: queriesMock.revalidateDashboardActivities,
}));

import { GET, POST } from "@/app/api/strava/webhook/route";

function sign(rawBody: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`;
}

/** Build a signed POST request; pass an explicit signature to test tampering. */
function postRequest(body: unknown, signature?: string): NextRequest {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = signature ?? sign(raw);
  if (sig !== "") headers["x-hub-signature-256"] = sig;
  return new NextRequest("http://localhost/api/strava/webhook", {
    method: "POST",
    headers,
    body: raw,
  });
}

/** Build a signed POST from a raw (possibly non-JSON) body string. */
function postRawRequest(raw: string): NextRequest {
  return new NextRequest("http://localhost/api/strava/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(raw) },
    body: raw,
  });
}

function getRequest(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/strava/webhook?${qs}`);
}

const CREATE_EVENT = {
  object_type: "activity",
  object_id: 555,
  aspect_type: "create",
  owner_id: 42,
};

beforeEach(() => {
  dbMock.reset();
  clientMock.getActivity.mockReset().mockResolvedValue({ id: 555, name: "Morning Run" });
  mappersMock.mapStravaToDb.mockReset().mockReturnValue({
    userId: "u1",
    stravaActivityId: 555,
    name: "Morning Run",
  });
  // Default: the athlete id resolves to no user; the ingest tests override this.
  queriesMock.getUserByStravaAthleteId.mockReset().mockResolvedValue(null);
  queriesMock.revalidateDashboardActivities.mockReset();
  coachMock.revalidateProgression.mockReset();
  vi.stubEnv("STRAVA_CLIENT_SECRET", SECRET);
  vi.stubEnv("STRAVA_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ===========================================================================
// GET — subscription validation handshake
// ===========================================================================

describe("GET (subscription handshake)", () => {
  it("echoes the challenge when mode and verify_token match", async () => {
    const res = GET(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "chal-123",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "hub.challenge": "chal-123" });
  });

  it("returns 403 when the verify_token does not match", async () => {
    const res = GET(
      getRequest({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "chal-123",
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when the challenge is missing", async () => {
    const res = GET(getRequest({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN }));
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// POST — signature verification
// ===========================================================================

describe("POST signature verification", () => {
  it("rejects a request with no signature header (401)", async () => {
    const res = await POST(postRequest(CREATE_EVENT, ""));
    expect(res.status).toBe(401);
    expect(queriesMock.getUserByStravaAthleteId).not.toHaveBeenCalled();
  });

  it("rejects a tampered/incorrect signature (401)", async () => {
    const res = await POST(postRequest(CREATE_EVENT, "sha256=deadbeef"));
    expect(res.status).toBe(401);
  });

  it("rejects a signature over a different body (401)", async () => {
    const req = postRequest(CREATE_EVENT, sign(JSON.stringify({ tampered: true })));
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects when STRAVA_CLIENT_SECRET is unset (fails closed, 401)", async () => {
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");
    // Signature can't be valid without a secret, but send a well-formed one.
    const res = await POST(postRequest(CREATE_EVENT, `sha256=${"0".repeat(64)}`));
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed body (200)", async () => {
    queriesMock.getUserByStravaAthleteId.mockResolvedValue({ id: "u1" });
    const res = await POST(postRequest(CREATE_EVENT));
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// POST — event routing
// ===========================================================================

describe("POST event routing", () => {
  it("acks non-activity events without touching the DB", async () => {
    const res = await POST(postRequest({ ...CREATE_EVENT, object_type: "athlete" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(queriesMock.getUserByStravaAthleteId).not.toHaveBeenCalled();
  });

  it("acks (200) an activity event for an unknown athlete without ingesting", async () => {
    queriesMock.getUserByStravaAthleteId.mockResolvedValue(null); // no matching user
    const res = await POST(postRequest(CREATE_EVENT));
    expect(res.status).toBe(200);
    expect(dbMock.db.transaction).not.toHaveBeenCalled();
    expect(clientMock.getActivity).not.toHaveBeenCalled();
  });

  it("ingests a create event: fetches, maps, upserts, and revalidates", async () => {
    queriesMock.getUserByStravaAthleteId.mockResolvedValue({ id: "u1" });
    const res = await POST(postRequest(CREATE_EVENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(clientMock.getActivity).toHaveBeenCalledWith(555);
    expect(mappersMock.mapStravaToDb).toHaveBeenCalledTimes(1);
    expect(dbMock.db.transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.db.insert).toHaveBeenCalledTimes(1);
    expect(coachMock.revalidateProgression).toHaveBeenCalledTimes(1);
    expect(queriesMock.revalidateDashboardActivities).toHaveBeenCalledWith("u1");
  });

  it("handles a delete event by removing the row, not fetching from Strava", async () => {
    queriesMock.getUserByStravaAthleteId.mockResolvedValue({ id: "u1" });
    const res = await POST(postRequest({ ...CREATE_EVENT, aspect_type: "delete" }));
    expect(res.status).toBe(200);
    expect(dbMock.db.delete).toHaveBeenCalledTimes(1);
    expect(clientMock.getActivity).not.toHaveBeenCalled();
    expect(coachMock.revalidateProgression).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed JSON body with 400 (terminal, no Strava retries)", async () => {
    const res = await POST(postRawRequest("{not valid json"));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid JSON");
    expect(queriesMock.getUserByStravaAthleteId).not.toHaveBeenCalled();
  });

  it("rejects a payload missing owner_id with a descriptive 400", async () => {
    const { owner_id, ...noOwner } = CREATE_EVENT;
    const res = await POST(postRequest(noOwner));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("owner_id");
    expect(queriesMock.getUserByStravaAthleteId).not.toHaveBeenCalled();
  });

  it("rejects a payload missing object_type with a descriptive 400", async () => {
    const { object_type, ...noType } = CREATE_EVENT;
    const res = await POST(postRequest(noType));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("object_type");
    expect(queriesMock.getUserByStravaAthleteId).not.toHaveBeenCalled();
  });

  it("returns 500 (so Strava retries) when ingestion throws", async () => {
    queriesMock.getUserByStravaAthleteId.mockResolvedValue({ id: "u1" });
    clientMock.getActivity.mockRejectedValueOnce(new Error("Strava API error 500"));
    const res = await POST(postRequest(CREATE_EVENT));
    expect(res.status).toBe(500);
    expect(coachMock.revalidateProgression).not.toHaveBeenCalled();
  });
});
