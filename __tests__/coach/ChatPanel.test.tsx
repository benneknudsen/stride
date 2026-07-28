/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ChatPanel } from "@/components/cobalt/coach/ChatPanel";
import { ROUTES } from "@/lib/routes";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const initialMessages = [{ id: "m1", role: "coach" as const, text: "Godmorgen!", synthetic: true }];

const prompts = ["Analysér min uge", "Foreslå næste pas"];

describe("ChatPanel — HTTP status error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("strips synthetic opening turns from the /api/ai/chat request (issue #201)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ role: "assistant", content: "Svar" }), { status: 200 })
      );

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Mit spørgsmål" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    // Only the visitor's real message reaches the model — never the scripted
    // synthetic greeting. Each user turn carries a client idempotency id.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: "user", content: "Mit spørgsmål" });
    expect(typeof body.messages[0].clientMessageId).toBe("string");
  });

  test("renders persisted history and sends it (non-synthetic) as fallback context (issue #202)", async () => {
    const withHistory = [
      { id: "h0", role: "user" as const, text: "Tidligere spørgsmål" },
      { id: "h1", role: "coach" as const, text: "Tidligere svar" },
      { id: "m1", role: "coach" as const, text: "Godmorgen!", synthetic: true },
    ];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ role: "assistant", content: "Svar" }), { status: 200 })
      );

    render(<ChatPanel initialMessages={withHistory} prompts={prompts} />);

    // The stored conversation is visible in the transcript — the whole point of
    // issue #202 (it used to never render).
    expect(screen.getByText("Tidligere spørgsmål")).toBeDefined();
    expect(screen.getByText("Tidligere svar")).toBeDefined();

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Nyt spørgsmål" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    // Real history turns flow to the route (its client-transcript fallback when
    // the DB read fails); only the synthetic opener is stripped. The new user
    // turn carries a client idempotency id for retry deduplication.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: "user", content: "Tidligere spørgsmål" });
    expect(body.messages[1]).toEqual({ role: "assistant", content: "Tidligere svar" });
    expect(body.messages[2]).toMatchObject({ role: "user", content: "Nyt spørgsmål" });
    expect(typeof body.messages[2].clientMessageId).toBe("string");
  });

  test("shows login prompt on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "authentication_required" }), { status: 401 })
    );

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Log ind for at chatte med coachen.")).toBeDefined();
    });

    const loginLink = screen.getByRole("link", { name: "Log ind" });
    expect(loginLink.getAttribute("href")).toBe(ROUTES.LOGIN);
  });

  test("shows rate-limited message with retry-after on 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "45" },
      })
    );

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Du har sendt mange beskeder/)).toBeDefined();
      expect(screen.getByText(/45 sekunder/)).toBeDefined();
    });
  });

  test("shows network error message on 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Tjek din forbindelse/)).toBeDefined();
    });
  });

  test("in visitor mode the composer is a login-CTA, not a message input (issue #203)", () => {
    render(
      <ChatPanel initialMessages={initialMessages} prompts={prompts} visitor demoReplies={{}} />
    );

    // No message input is promised to a visitor who can't actually chat.
    expect(screen.queryByLabelText("Skriv til din coach")).toBeNull();
    expect(screen.queryByLabelText("Send besked")).toBeNull();

    // Instead: an honest login prompt with a link to the login route.
    expect(screen.getByText("Log ind for at chatte med din coach.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Log ind" }).getAttribute("href")).toBe(ROUTES.LOGIN);
  });

  test("visitor chip tap shows a scripted answer without touching the network (issue #203)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <ChatPanel
        initialMessages={initialMessages}
        prompts={["Analysér min uge"]}
        visitor
        demoReplies={{ "Analysér min uge": "Din uge ser stærk ud." }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Analysér min uge" }));

    // The visitor's question and the scripted answer both land in the transcript…
    expect(screen.getByText("Din uge ser stærk ud.")).toBeDefined();
    // …the chip label also appears as the visitor's own bubble.
    expect(screen.getAllByText("Analysér min uge").length).toBeGreaterThan(1);

    // …and nothing ever hit /api/ai/chat, so no "tjek din forbindelse" bubble.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Tjek din forbindelse/)).toBeNull();
  });

  test("renders fallback answer when response body is missing but text is present", async () => {
    const ndjson = [
      JSON.stringify({ role: "assistant", content: "Det ser " }),
      JSON.stringify({ role: "assistant", content: "godt ud!" }),
    ].join("\n");

    // Some WebViews/proxies strip the streaming body. Simulate a 200 where
    // `res.body` is null but `res.text()` still returns the full NDJSON payload.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
      text: async () => ndjson,
    } as Response);

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Det ser godt ud!")).toBeDefined();
    });
  });

  test("disables the send button and chips while streaming, and offers a stop button (issue #205)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      // Never-resolving stream so the panel stays in streaming state.
      const stream = new ReadableStream<Uint8Array>({
        start() {},
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByLabelText("Stop svaret")).toBeDefined();
    });

    const sendButton = screen.queryByLabelText("Send besked");
    expect(sendButton).toBeNull();

    const chips = screen
      .getAllByRole("button")
      .filter((b) => prompts.includes(b.textContent ?? ""));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.hasAttribute("disabled")).toBe(true);
    }

    fetchSpy.mockRestore();
  });

  test("stopping the stream keeps the partial answer and restores the send button (issue #205)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          const encoder = new TextEncoder();
          c.enqueue(
            encoder.encode(`${JSON.stringify({ role: "assistant", content: "Delvis " })}\n`)
          );
          signal?.addEventListener("abort", () => c.close());
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });

    render(<ChatPanel initialMessages={initialMessages} prompts={prompts} />);

    const input = screen.getByLabelText("Skriv til din coach");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Delvis")).toBeDefined());

    fireEvent.click(screen.getByLabelText("Stop svaret"));

    await waitFor(() => expect(screen.getByLabelText("Send besked")).toBeDefined());
    expect(screen.getByText("Delvis")).toBeDefined();

    fetchSpy.mockRestore();
  });
});
