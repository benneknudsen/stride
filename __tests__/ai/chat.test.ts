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

const { authMock, streamTextMock, insertChatMessageMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  streamTextMock: vi.fn(),
  insertChatMessageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));

vi.mock("@/lib/db/queries", () => ({
  getChatHistory: vi.fn().mockResolvedValue([]),
  getDashboardActivities: vi.fn().mockResolvedValue([]),
  getRacePlan: vi.fn().mockResolvedValue(null),
  insertChatMessage: insertChatMessageMock,
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

import { POST } from "@/app/api/ai/chat/route";
import { getDashboardActivities, insertChatMessage } from "@/lib/db/queries";

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
    fullStream: (async function* () {
      for (const text of deltas) {
        yield { type: "text-delta", text };
      }
    })(),
  }));
}

beforeEach(() => {
  resetRateLimit();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  streamTextMock.mockReset();
  insertChatMessageMock.mockClear();
  stubTextStream(["Hej ", "Benjamin!"]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ai/chat", () => {
  it("streams the scripted NDJSON notice when no AI key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
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
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    authMock.mockResolvedValue(null);

    const res = await POST(chatRequest());

    expect(res.status).toBe(401);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("streams NDJSON reply fragments when authed and configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

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
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

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
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => {
      throw new Error("provider down");
    });

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    expect(replies).toHaveLength(1);
    expect(replies[0].content).toContain("kunne ikke svare");
  });

  it("falls through to the fallback candidate when the first streams nothing (#208)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // A provider that fails politely — bad model id, no endpoint supporting
    // tool calls, quota — reports an `error` part instead of throwing, and
    // `onError` keeps it out of the catch. The router must treat that as a
    // dead candidate and try the next model, not as an answer.
    streamTextMock
      .mockImplementationOnce(() => ({
        fullStream: (async function* () {
          yield { type: "error", error: new Error("no endpoints found that support tool use") };
        })(),
      }))
      .mockImplementationOnce(() => ({
        fullStream: (async function* () {
          yield { type: "text-delta", text: "Rolig 5 km i dag." };
        })(),
      }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    // Read the body first — the stream's `start()` only runs to completion as
    // the response is consumed, so the call count isn't final before that.
    const replies = await readReplies(res);
    expect(replies.map((r) => r.content).join("")).toBe("Rolig 5 km i dag.");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it("streams the scripted floor instead of a 500 when the tools cannot be built", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // A row whose startDate is neither a Date nor an ISO string makes
    // `ensureDate` throw inside `buildCoachTools` — the synchronous step that
    // used to take the whole route down with a 500 (#190/#194/#195).
    vi.mocked(getDashboardActivities).mockResolvedValueOnce([
      { type: "Run", startDate: 0, distance: 8000, movingTime: 2400, averageHeartrate: 150 },
      { type: "Run", startDate: 0, distance: 9000, movingTime: 2700, averageHeartrate: 150 },
    ] as never);

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    expect(replies).toHaveLength(1);
    expect(replies[0].content).toContain("kunne ikke svare");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("rejects an empty message list", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const res = await POST(chatRequest({ messages: [] }));

    expect(res.status).toBe(400);
  });

  it("rejects a message whose content exceeds the length cap (#169)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const oversize: ChatMessage[] = [{ role: "user", content: "a".repeat(4001) }];
    const res = await POST(chatRequest({ messages: oversize }));

    expect(res.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("rejects a request with too many messages (#169)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const tooMany: ChatMessage[] = Array.from({ length: 51 }, () => ({
      role: "user" as const,
      content: "Hej",
    }));
    const res = await POST(chatRequest({ messages: tooMany }));

    expect(res.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("streams a full answer from a mock model that uses two tool rounds (#198)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "tool-call", toolCallId: "tc-1", toolName: "getProgression", args: {} };
        yield { type: "tool-result", toolCallId: "tc-1", result: { hasFullWindow: true } };
        yield { type: "tool-call", toolCallId: "tc-2", toolName: "recommendWorkout", args: {} };
        yield { type: "tool-result", toolCallId: "tc-2", result: { workout: "5 km zone 2" } };
        yield { type: "text-delta", text: "Du skal løbe " };
        yield { type: "text-delta", text: "5 km i dag." };
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    expect(replies.map((r) => r.content).join("")).toBe("Du skal løbe 5 km i dag.");
    expect(insertChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: "user-1",
        role: "assistant",
        content: "Du skal løbe 5 km i dag.",
      })
    );
  });

  it("emits a truncation marker and does not persist a partial answer (#198)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Det ser " };
        throw new Error("stream broke");
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const fullText = replies.map((r) => r.content).join("");
    expect(fullText).toContain("Det ser");
    expect(fullText).toContain("Svaret blev afbrudt");
    expect(insertChatMessage).not.toHaveBeenCalled();
  });

  it("marks a reply truncated when an error-part follows streamed text (#218)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // The provider streams some text and then reports failure as an `error`
    // part (not a thrown exception). `onError` logs it, so the loop must
    // itself notice the error and treat the half answer as truncated —
    // otherwise the partial reply is persisted as if it were complete.
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Det ser " };
        yield { type: "error", error: new Error("stream broke mid-answer") };
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const fullText = replies.map((r) => r.content).join("");
    expect(fullText).toContain("Det ser");
    expect(fullText).toContain("Svaret blev afbrudt");
    expect(insertChatMessage).not.toHaveBeenCalled();
  });
});
