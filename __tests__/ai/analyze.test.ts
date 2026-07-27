/**
 * Integration tests for POST /api/ai/analyze.
 *
 * `@/lib/auth` is mocked (the real module builds a NextAuth adapter against the
 * DB at import time), the DB queries are stubbed, and `ai`'s `streamObject` is
 * mocked so no provider is ever called — everything else (zod validation, rate
 * limiting, the #209 gating, the NDJSON stream plumbing) runs for real.
 */

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";

const { authMock, streamObjectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  streamObjectMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));

vi.mock("@/lib/db/queries", () => ({
  getCachedAnalysis: vi.fn().mockResolvedValue(null),
  insertAnalysis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamObject: streamObjectMock };
});

import { POST } from "@/app/api/ai/analyze/route";

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

/** Parse an NDJSON response body into analysis-block objects. */
async function readBlocks(res: Response): Promise<unknown[]> {
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
  streamObjectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ai/analyze", () => {
  it("serves heuristic blocks to a visitor even with an AI key configured (#209)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    authMock.mockResolvedValue(null); // visitor: no session

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    const blocks = await readBlocks(res);
    expect(blocks.length).toBeGreaterThan(0);
    // The live-AI path is never touched for an unauthenticated visitor.
    expect(streamObjectMock).not.toHaveBeenCalled();
  });

  it("serves heuristic blocks to a visitor when no AI key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    authMock.mockResolvedValue(null);

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    expect(blocks.length).toBeGreaterThan(0);
    expect(streamObjectMock).not.toHaveBeenCalled();
  });

  it("serves heuristic blocks to a signed-in user when no AI key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    authMock.mockResolvedValue({ user: { id: "user-1" } });

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    expect(blocks.length).toBeGreaterThan(0);
    expect(streamObjectMock).not.toHaveBeenCalled();
  });

  it("takes the live-AI path for a signed-in user when configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    streamObjectMock.mockImplementation(() => ({
      elementStream: (async function* () {
        yield {
          tool: "insightCard",
          title: "Stærk uge",
          body: "Du løb mere end sidste uge.",
          metric: "24 km",
          sentiment: "positive",
        };
      })(),
    }));

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(200);
    const blocks = await readBlocks(res);
    expect(blocks.length).toBeGreaterThan(0);
    expect(streamObjectMock).toHaveBeenCalled();
  });

  it("rate limits a visitor after the per-IP heuristic window is full", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
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

  it("rejects an empty activity list", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const res = await POST(analyzeRequest({ activities: [] }));

    expect(res.status).toBe(400);
  });
});
