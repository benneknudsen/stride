/**
 * Integration tests for POST /api/ai/analyze.
 *
 * `@/lib/auth` is mocked (the real module builds a NextAuth adapter against the
 * DB at import time). Everything else runs for real: zod validation, the
 * per-IP rate limit, the anonymous payload cap and the NDJSON stream plumbing.
 * There is no provider to stub — the route's only source of blocks is
 * `heuristicBlocks`, so every response is derived from the submitted activities.
 *
 * Also unit-tests `clientIp` (#264): the pre-auth rate-limit key must prefer
 * trustworthy headers over the client-controlled first XFF hop.
 */

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analysisBlockSchema } from "@/lib/ai/tools";
import { resetRateLimit } from "@/lib/rate-limit";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { clientIp, POST } from "@/app/api/ai/analyze/route";

interface RequestActivity {
  startDate: string;
  distance: number;
  movingTime: number;
}

const ACTIVITIES: RequestActivity[] = [
  { startDate: "2026-07-01T06:00:00.000Z", distance: 8000, movingTime: 2400 },
  { startDate: "2026-07-03T06:00:00.000Z", distance: 10000, movingTime: 3000 },
  { startDate: "2026-07-06T06:00:00.000Z", distance: 6000, movingTime: 1800 },
];

function analyzeRequest(body: unknown = { activities: ACTIVITIES }): NextRequest {
  return new Request("http://localhost/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** A POST request carrying arbitrary headers — for `clientIp` unit tests. */
function ipRequest(headers: Record<string, string>): NextRequest {
  return new Request("http://localhost/api/ai/analyze", {
    method: "POST",
    headers,
  }) as unknown as NextRequest;
}

/** N minimal 1 km activities on consecutive days, for payload-cap tests. */
function manyActivities(count: number): RequestActivity[] {
  return Array.from({ length: count }, (_, i) => ({
    startDate: new Date(Date.UTC(2026, 0, 1 + i, 6)).toISOString(),
    distance: 1000,
    movingTime: 300,
  }));
}

/** Parse an NDJSON response body into analysis-block objects. */
async function readBlocks(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  resetRateLimit();
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

describe("POST /api/ai/analyze", () => {
  it("streams the same grounded blocks to a visitor and to a signed-in runner", async () => {
    const visitor = await POST(analyzeRequest());
    expect(visitor.status).toBe(200);
    expect(visitor.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    const visitorBlocks = await readBlocks(visitor);
    expect(visitorBlocks.length).toBeGreaterThan(0);

    authMock.mockResolvedValue({ user: { id: "user-1" } });
    const member = await POST(analyzeRequest());
    expect(member.status).toBe(200);
    const memberBlocks = await readBlocks(member);

    // No provider, no session gating: the blocks depend only on the activities.
    expect(memberBlocks).toEqual(visitorBlocks);
  });

  it("only ever emits schema-valid blocks", async () => {
    const res = await POST(analyzeRequest());

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(analysisBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it("rate limits a visitor after the per-IP window is full", async () => {
    authMock.mockResolvedValue(null);

    for (let i = 0; i < 30; i++) {
      const res = await POST(analyzeRequest());
      expect(res.status).toBe(200);
    }

    const blocked = await POST(analyzeRequest());
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("caps the anonymous activity payload before any compute (#264)", async () => {
    authMock.mockResolvedValue(null);

    // 150 client-supplied activities arrive, but the blocks must only ever
    // summarise MAX_ANON_ACTIVITIES (100) — defense-in-depth against a rotated
    // pre-auth rate-limit key on self-hosted deployments.
    const res = await POST(analyzeRequest({ activities: manyActivities(150) }));

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    const insight = blocks.find((b) => b.tool === "insightCard") as { body: string };
    // heuristicBlocks reports the reduced totals: "På ${totalRuns} ture har du
    // løbet ${totalDistanceKm} km, …" — 100 runs × 1 km, not 150.
    expect(insight.body).toMatch(/^På 100 ture har du løbet 100 km/);
  });

  it("keeps the full payload for a signed-in runner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });

    const res = await POST(analyzeRequest({ activities: manyActivities(150) }));

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    const insight = blocks.find((b) => b.tool === "insightCard") as { body: string };
    expect(insight.body).toMatch(/^På 150 ture har du løbet 150 km/);
  });

  it("rejects an empty activity list", async () => {
    const res = await POST(analyzeRequest({ activities: [] }));

    expect(res.status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    const res = (await new Request("http://localhost/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })) as unknown as NextRequest;

    const result = await POST(res);
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "invalid_json" });
  });
});

describe("clientIp (#264)", () => {
  it("prefers x-real-ip over the client-controlled first XFF hop", () => {
    const req = ipRequest({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.9, 10.0.0.1, 10.0.0.2",
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("uses the LAST x-forwarded-for hop when x-real-ip is missing", () => {
    const req = ipRequest({ "x-forwarded-for": "a, b, c" });
    expect(clientIp(req)).toBe("c");
  });

  it("falls back to the shared unknown bucket when no IP headers are present", () => {
    expect(clientIp(ipRequest({}))).toBe("unknown");
  });
});
