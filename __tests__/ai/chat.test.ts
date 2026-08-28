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
import type { ChatBlock, ChatMessage, ChatReply } from "@/types/chat";

/**
 * A parsed NDJSON line for assertions. Intersecting the `ChatReply` union with
 * the optional wire fields lets a test read `.content` (text lines) or `.block`
 * (block lines) off any reply after narrowing on `.type` (issue #221).
 */
type WireReply = ChatReply & { content?: string; block?: ChatBlock };

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
  deleteExpiredChatMessages: vi.fn().mockResolvedValue(0),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

import { POST } from "@/app/api/ai/chat/route";
import { getChatHistory, getDashboardActivities, insertChatMessage } from "@/lib/db/queries";

const MESSAGES: ChatMessage[] = [{ role: "user", content: "Hvad skal jeg løbe i dag?" }];

function chatRequest(body: unknown = { messages: MESSAGES }): NextRequest {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** Parse an NDJSON response body into reply lines. */
async function readReplies(res: Response): Promise<WireReply[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WireReply);
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

  it("emits an activity block from a getRecentActivities tool result (#221)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "tool-call", toolCallId: "tc-1", toolName: "getRecentActivities", input: {} };
        yield {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "getRecentActivities",
          output: [
            {
              id: "act-42",
              type: "Run",
              startDate: "2026-07-25T06:00:00.000Z",
              distance: 8000,
              movingTime: 2400,
              averageHeartrate: 148,
              // Extra prose-only fields must be stripped from the block.
              distanceKm: 8,
              pace: "5:00",
            },
          ],
        };
        yield { type: "text-delta", text: "Din seneste tur var stærk." };
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const blocks = replies.filter((r) => r.type === "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      role: "assistant",
      type: "block",
      block: {
        kind: "activity",
        activity: {
          id: "act-42",
          type: "Run",
          startDate: "2026-07-25T06:00:00.000Z",
          distance: 8000,
          movingTime: 2400,
          averageHeartrate: 148,
        },
      },
    });
    // The prose still streams as text alongside the block.
    const text = replies
      .filter((r) => r.type === "text")
      .map((r) => r.content)
      .join("");
    expect(text).toBe("Din seneste tur var stærk.");
    // Persisted as a lightweight reference so the card is rehydrated on replay
    // and stays in sync with the current activity row (issue #228).
    expect(insertChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: "user-1",
        role: "assistant",
        blocks: [{ kind: "activity", id: "act-42" }],
      })
    );
  });

  it("emits a workout block from a recommendWorkout tool result (#221)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "recommendWorkout",
          output: {
            type: "tempo",
            distanceKm: 10,
            paceRange: { min: "4:45", max: "5:05" },
            heartRateCap: 172,
            shoe: "adios-pro-4",
            reason: ["Tempo-tolerance", "Restitution ok"],
            // weekStrip is not rendered on the chat card and must be stripped.
            weekStrip: [{ weekday: "mon", type: "tempo", description: "Tempo" }],
          },
        };
        yield { type: "text-delta", text: "Kør et tempopas." };
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const blocks = replies.filter((r) => r.type === "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].block).toEqual({
      kind: "workout",
      workout: {
        type: "tempo",
        distanceKm: 10,
        paceRange: { min: "4:45", max: "5:05" },
        heartRateCap: 172,
        shoe: "adios-pro-4",
        reason: ["Tempo-tolerance", "Restitution ok"],
      },
    });
    // Workout recommendations are time-sensitive and intentionally not persisted
    // so a replayed turn does not present stale advice as current (issue #228).
    expect(insertChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: "user-1",
        role: "assistant",
        blocks: undefined,
      })
    );
  });

  it("exposes getNextActivity and tells the model to use it for alternatives (#258)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    await POST(chatRequest({ messages: [{ role: "user", content: "Giv mig noget andet" }] }));

    const call = streamTextMock.mock.calls[0][0] as {
      system: string;
      tools: Record<string, unknown>;
    };
    // The variety engine must be reachable from chat at all — before #258 the
    // model had no tool that could produce an alternative session.
    expect(call.tools).toHaveProperty("getNextActivity");
    // …and the prompt must send the model there for "noget andet"-style asks,
    // instead of repeating the same relaxed Zone 2 pas via recommendWorkout.
    expect(call.system).toContain("getNextActivity");
    expect(call.system).toContain("noget andet end det sædvanlige");
    expect(call.system).toMatch(/fartlek/i);
    expect(call.system).toMatch(/intervaller/i);
    // recommendWorkout stays the default answer to "what should I run today".
    expect(call.system).toContain('standardsvaret på "hvad skal jeg løbe i dag?"');
  });

  it("emits a variation block from a getNextActivity tool result (#258)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "getNextActivity",
          output: {
            type: "intervals",
            distanceKm: 10,
            paceRange: { min: "4:20", max: "4:45" },
            // Full-intensity reps carry no ceiling — the block schema must
            // accept null where the workout card requires a number.
            heartRateCap: null,
            basis: "Sidste 5 ture: 5 rolige · 0 kvalitet · 0 lange",
            reason: ["Der mangler rigtige fartpas"],
          },
        };
        yield { type: "text-delta", text: "Prøv intervaller i stedet." };
      })(),
    }));

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const blocks = replies.filter((r) => r.type === "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].block).toEqual({
      kind: "variation",
      variation: {
        type: "intervals",
        distanceKm: 10,
        paceRange: { min: "4:20", max: "4:45" },
        heartRateCap: null,
        basis: "Sidste 5 ture: 5 rolige · 0 kvalitet · 0 lange",
        reason: ["Der mangler rigtige fartpas"],
      },
    });
    // Like the workout card, a variation is time-sensitive advice — it stays out
    // of the persisted history so a replayed turn can't present it as current
    // (issue #228).
    expect(insertChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "user-1", role: "assistant", blocks: undefined })
    );
  });

  it("skips a block when the tool output fails validation (no fabrication) (#221)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* () {
        yield {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "getRecentActivities",
          // Missing `id` — cannot build a valid card, so no block is emitted.
          output: [{ type: "Run", distance: 8000, movingTime: 2400, averageHeartrate: 148 }],
        };
        yield { type: "text-delta", text: "Her er din uge." };
      })(),
    }));

    const res = await POST(chatRequest());

    const replies = await readReplies(res);
    expect(replies.filter((r) => r.type === "block")).toHaveLength(0);
    expect(
      replies
        .filter((r) => r.type === "text")
        .map((r) => r.content)
        .join("")
    ).toBe("Her er din uge.");
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
    // A provider that streams some text and then reports failure as an `error`
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

  it("strips harmony control tokens and internal reasoning from the reply (#222)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    stubTextStream([
      "<|channel|>thought<|channel|>internal reasoning",
      "<|channel|>final<|channel|>actual answer<|end|>",
    ]);

    const res = await POST(chatRequest());

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    const text = replies.map((r) => r.content).join("");
    expect(text).toBe("actual answer");
    expect(text).not.toContain("<|");
    expect(text).not.toContain("internal reasoning");
    // The persisted answer is the clean text only, never the control tokens.
    expect(insertChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "assistant", content: "actual answer" })
    );
  });

  it("strips a harmony marker split across two text-delta parts (#222)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // The opening channel marker is split mid-token between the two deltas.
    stubTextStream([
      "<|chan",
      "nel|>thought<|channel|>skjult<|channel|>final<|channel|>svaret<|end|>",
    ]);

    const res = await POST(chatRequest());

    const replies = await readReplies(res);
    const text = replies.map((r) => r.content).join("");
    expect(text).toBe("svaret");
    expect(text).not.toContain("<|");
    expect(text).not.toContain("skjult");
  });

  it("leaves a normal reply without markers unchanged (#222)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    stubTextStream(["Rolig 5 km ", "i zone 2."]);

    const res = await POST(chatRequest());

    const replies = await readReplies(res);
    expect(replies.map((r) => r.content).join("")).toBe("Rolig 5 km i zone 2.");
  });

  it("does not duplicate a user turn on retry with the same clientMessageId (#205)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const clientId = "retry-id-1";

    // First request succeeds and persists the turn — under the server-derived
    // row id, never the raw client key (#270).
    const first = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: clientId }] })
    );
    expect(first.status).toBe(200);
    await readReplies(first);
    expect(insertChatMessage).toHaveBeenCalledTimes(2);
    expect(insertChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "user-1::retry-id-1",
        userId: "user-1",
        role: "user",
        content: "Hej",
      })
    );

    // Second request carries the same clientMessageId: it should be treated as a
    // retry and neither insert the user turn again nor add a second assistant.
    // The mocked history row uses the pre-#270 raw id format, which must keep
    // deduplicating (legacy rows written before the derived id existed).
    vi.mocked(getChatHistory).mockResolvedValueOnce([
      { id: clientId, role: "user", content: "Hej" },
      { id: "assistant-1", role: "assistant", content: "Hej!" },
    ]);
    insertChatMessageMock.mockClear();

    const second = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: clientId }] })
    );
    expect(second.status).toBe(200);
    await readReplies(second);
    expect(insertChatMessage).not.toHaveBeenCalled();
  });

  it("persists the user turn under a server-derived row id with the client id sanitized (#270)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const res = await POST(
      chatRequest({
        messages: [{ role: "user", content: "Hej", clientMessageId: "cli\tent key-1" }],
      })
    );

    expect(res.status).toBe(200);
    await readReplies(res);
    expect(insertChatMessage).toHaveBeenCalledTimes(2);
    // The row id is `${userId}::${sanitized clientMessageId}` — whitespace and
    // control characters stripped, user-scoped — and the assistant turn keeps
    // its schema-generated id.
    expect(insertChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "user-1::clientkey-1",
        userId: "user-1",
        role: "user",
        content: "Hej",
      })
    );
    expect(insertChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: "user-1", role: "assistant" })
    );
    const assistantCall = insertChatMessageMock.mock.calls[1]?.[0] as { id?: string } | undefined;
    expect(assistantCall?.id).toBeUndefined();
  });

  it("derives collision-free row ids when two users send the same clientMessageId (#270)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    authMock.mockResolvedValue({ user: { id: "user-1" } });
    const first = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: "shared-key" }] })
    );
    expect(first.status).toBe(200);
    await readReplies(first);

    authMock.mockResolvedValue({ user: { id: "user-2" } });
    const second = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: "shared-key" }] })
    );
    expect(second.status).toBe(200);
    await readReplies(second);

    // Both user turns persist — the shared client key is scoped behind each
    // user id, so neither insert collides on the primary key.
    const userInserts = insertChatMessageMock.mock.calls.filter(
      (call) => (call[0] as { role: string }).role === "user"
    );
    expect(userInserts).toHaveLength(2);
    const ids = userInserts.map((call) => (call[0] as { id?: string }).id);
    expect(ids).toEqual(["user-1::shared-key", "user-2::shared-key"]);
  });

  it("does not duplicate a retry when history carries the derived row id (#270)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const clientId = "retry-id-2";

    const first = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: clientId }] })
    );
    expect(first.status).toBe(200);
    await readReplies(first);

    // A post-#270 history row is stored under the derived id; the retry with
    // the same clientMessageId must still deduplicate against it.
    vi.mocked(getChatHistory).mockResolvedValueOnce([
      { id: "user-1::retry-id-2", role: "user", content: "Hej" },
      { id: "assistant-1", role: "assistant", content: "Hej!" },
    ]);
    insertChatMessageMock.mockClear();

    const second = await POST(
      chatRequest({ messages: [{ role: "user", content: "Hej", clientMessageId: clientId }] })
    );
    expect(second.status).toBe(200);
    await readReplies(second);
    expect(insertChatMessage).not.toHaveBeenCalled();
  });

  it("keeps the NDJSON reply shape and never leaks the derived row id (#270)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const res = await POST(
      chatRequest({
        messages: [{ role: "user", content: "Hej", clientMessageId: "leak-check-1" }],
      })
    );

    expect(res.status).toBe(200);
    const replies = await readReplies(res);
    expect(replies.map((r) => r.content).join("")).toBe("Hej Benjamin!");
    // The client keeps its own idempotency key and the wire shape is unchanged:
    // the internal row id is never streamed back to the browser.
    for (const reply of replies) {
      const wire = JSON.stringify(reply);
      expect(wire).not.toContain("user-1::");
      expect(wire).not.toContain("leak-check-1");
    }
  });
});
