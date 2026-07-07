/**
 * Integration tests for POST /api/ai/chat.
 *
 * `@/lib/auth` is mocked (the real module builds a NextAuth adapter against
 * the DB at import time) and `ai`'s `streamText` is mocked so no provider is
 * ever called — everything else (zod validation, rate limiting, gating, the
 * NDJSON stream plumbing) runs for real.
 */

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";
import type { ChatMessage, ChatReply } from "@/types/chat";

const { authMock, streamTextMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

import { POST } from "@/app/api/ai/chat/route";

const MESSAGES: ChatMessage[] = [{ role: "user", content: "Hvad skal jeg løbe i dag?" }];

function chatRequest(body: unknown = { messages: MESSAGES }): NextRequest {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** Parse an NDJSON response body into `ChatReply` lines. */
async function readReplies(res: Response): Promise<ChatReply[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ChatReply);
}

function stubTextStream(deltas: string[]): void {
  streamTextMock.mockImplementation(() => ({
    textStream: (async function* () {
      yield* deltas;
    })(),
  }));
}

beforeEach(() => {
  resetRateLimit();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  streamTextMock.mockReset();
  stubTextStream(["Hej ", "Benjamin!"]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ai/chat", () => {
  it("streams the scripted NDJSON notice when no AI key is configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    authMock.mockResolvedValue(null); // no session required in demo mode

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    const replies = await readReplies(res);
    expect(replies).toHaveLength(1);
    expect(replies[0].role).toBe("assistant");
    expect(replies[0].content).toContain("ikke aktiveret");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("returns 401 without a session when an AI key is configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    authMock.mockResolvedValue(null);

    const res = await POST(chatRequest());

    expect(res.status).toBe(401);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("streams NDJSON reply fragments when authed and configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const replies = await readReplies(res);
    expect(replies.length).toBeGreaterThan(0);
    for (const reply of replies) {
      expect(reply.role).toBe("assistant");
    }
    expect(replies.map((r) => r.content).join("")).toBe("Hej Benjamin!");
  });

  it("rate limits a user after 30 requests in the window", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    for (let i = 0; i < 30; i++) {
      const res = await POST(chatRequest());
      expect(res.status).toBe(200);
    }

    const blocked = await POST(chatRequest());
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("streams the scripted floor when every provider fails", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => {
      throw new Error("provider down");
    });

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    expect(replies).toHaveLength(1);
    expect(replies[0].content).toContain("kunne ikke svare");
  });

  it("rejects an empty message list", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

    const res = await POST(chatRequest({ messages: [] }));

    expect(res.status).toBe(400);
  });
});
