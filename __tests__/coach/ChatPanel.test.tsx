/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ChatPanel } from "@/components/cobalt/coach/ChatPanel";
import { ROUTES } from "@/lib/routes";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/actions/chat", () => ({
  clearChatHistory: vi.fn().mockResolvedValue({ ok: true }),
}));

// Issue #266 drives the keyboard effect off `keyboardOpen`/`viewportHeight`/
// `viewportOffsetTop`, so those hooks are mocked to controllable values the
// tests mutate between renders (the component reads primitives from them).
const viewportMock = vi.hoisted(() => {
  const state = {
    height: null as number | null,
    offsetTop: 0,
    keyboardOpen: false,
  };
  return {
    state,
    useVisualViewport: () => ({ height: state.height, offsetTop: state.offsetTop }),
    useKeyboardOpen: () => state.keyboardOpen,
  };
});

vi.mock("@/hooks/useVisualViewport", () => viewportMock);

// Render probe for the issue #266 styling tests: the real MessageBubble is
// React.memo'd, so it would bail out exactly when the panel re-renders. This
// faithful stand-in drops the memo (DOM output is plain text, which is all
// these tests assert on) and counts every render pass.
const bubbleSpy = vi.hoisted(() => ({ renders: 0 }));

vi.mock("@/components/cobalt/coach/MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { text: string } }) => {
    bubbleSpy.renders += 1;
    return <div>{message.text}</div>;
  },
}));

const initialMessages = [{ id: "m1", role: "coach" as const, text: "Godmorgen!", synthetic: true }];

const prompts = ["Analysér min uge", "Foreslå næste pas"];

describe("ChatPanel — HTTP status error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        demoReplies={{ "Analysér min uge": { text: "Din uge ser stærk ud." } }}
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

describe("ChatPanel — panel styling & keyboard rAF (issue #266)", () => {
  // Manual rAF queue: frames only run when `flush()` says so, which lets the
  // tests prove a queued frame is cancelled (cleanup) rather than merely
  // deferred. jsdom's rAF would run on its own timer and hide the difference.
  const rafMock = (() => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    let originalRaf: typeof window.requestAnimationFrame;
    let originalCaf: typeof window.cancelAnimationFrame;
    return {
      install() {
        frames.clear();
        nextId = 0;
        originalRaf = window.requestAnimationFrame;
        originalCaf = window.cancelAnimationFrame;
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
          const id = ++nextId;
          frames.set(id, cb);
          return id;
        }) as typeof window.requestAnimationFrame;
        window.cancelAnimationFrame = ((id: number) => {
          frames.delete(id);
        }) as typeof window.cancelAnimationFrame;
      },
      restore() {
        window.requestAnimationFrame = originalRaf;
        window.cancelAnimationFrame = originalCaf;
      },
      pending: () => frames.size,
      flush: () => {
        const queued = [...frames.values()];
        frames.clear();
        for (const cb of queued) cb(performance.now());
        return queued.length;
      },
    };
  })();

  // A fresh element per render/rerender — React skips an update entirely when
  // it is handed the identical element reference.
  const panel = () => <ChatPanel initialMessages={initialMessages} prompts={prompts} />;

  const wrapperOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

  beforeEach(() => {
    viewportMock.state.height = null;
    viewportMock.state.offsetTop = 0;
    viewportMock.state.keyboardOpen = false;
    bubbleSpy.renders = 0;
    rafMock.install();
  });

  afterEach(() => {
    rafMock.restore();
  });

  test("viewport events that recompute an identical style do not re-render the panel", () => {
    viewportMock.state.keyboardOpen = true;
    viewportMock.state.height = 500;
    viewportMock.state.offsetTop = 0;

    const { container, rerender } = render(panel());
    const wrapper = wrapperOf(container);
    // Keyboard open, below lg: height driven off the visual viewport —
    // 500px minus the 16px keyboard gap (the wrapper's top is 0 in jsdom).
    expect(wrapper.style.maxHeight).toBe("484px");
    expect(wrapper.style.minHeight).toBe("220px");

    // Mount = initial render + one pass applying the computed style.
    const rendersAfterMount = bubbleSpy.renders;

    // iOS keyboard scroll: the visual viewport shifts down (offsetTop up) while
    // shrinking — offsetTop + height is unchanged, so the recomputed style is
    // content-identical and the panel must bail out on the same style object.
    viewportMock.state.height = 400;
    viewportMock.state.offsetTop = 100;
    rerender(panel());

    expect(wrapper.style.maxHeight).toBe("484px");
    expect(wrapper.style.minHeight).toBe("220px");
    // Exactly one extra render: the rerender itself. A further one would mean
    // the unchanged style was re-set with fresh object identity.
    expect(bubbleSpy.renders).toBe(rendersAfterMount + 1);
  });

  test("with the keyboard closed, viewport events keep the empty style referentially stable", () => {
    viewportMock.state.keyboardOpen = false;
    viewportMock.state.height = 500;
    viewportMock.state.offsetTop = 0;

    const { container, rerender } = render(panel());
    const wrapper = wrapperOf(container);
    // Keyboard closed: the CSS dvh clamp owns the height, so the inline style is
    // empty — and since prev {} shallow-equals the new {}, even the mount run
    // bails out (no render beyond the initial one).
    expect(wrapper.style.maxHeight).toBe("");
    expect(bubbleSpy.renders).toBe(1);
    const rendersAfterMount = bubbleSpy.renders;

    viewportMock.state.height = 400;
    rerender(panel());
    viewportMock.state.height = 420;
    viewportMock.state.offsetTop = 10;
    rerender(panel());

    expect(wrapper.style.maxHeight).toBe("");
    // Only the two rerender renders themselves — the unchanged {} style never
    // schedules another render, no matter how many viewport events arrive.
    expect(bubbleSpy.renders).toBe(rendersAfterMount + 2);
  });

  test("viewport changes that alter the computed style still apply it (regression)", () => {
    viewportMock.state.keyboardOpen = true;
    viewportMock.state.height = 500;
    viewportMock.state.offsetTop = 0;

    const { container, rerender } = render(panel());
    const wrapper = wrapperOf(container);
    expect(wrapper.style.maxHeight).toBe("484px");
    expect(wrapper.style.minHeight).toBe("220px");

    viewportMock.state.height = 200;
    rerender(panel());

    // available = 200 - 16 = 184px, and the 220px floor clamps down to it.
    expect(wrapper.style.maxHeight).toBe("184px");
    expect(wrapper.style.minHeight).toBe("184px");
  });

  test("a pending keyboard rAF is cancelled when the effect re-runs", () => {
    viewportMock.state.keyboardOpen = true;
    viewportMock.state.height = 500;
    viewportMock.state.offsetTop = 0;

    const { container, rerender } = render(panel());

    // The mount run queued exactly one scroll frame (panel starts pinned).
    expect(rafMock.pending()).toBe(1);

    const scrollEl = container.querySelector('[role="log"]') as HTMLElement;
    let scrollTopWrites = 0;
    Object.defineProperty(scrollEl, "scrollTop", {
      configurable: true,
      get: () => 0,
      set: () => {
        scrollTopWrites += 1;
      },
    });

    viewportMock.state.height = 400;
    rerender(panel());

    // Cleanup cancelled the mount frame; the re-run queued exactly one.
    expect(rafMock.pending()).toBe(1);
    rafMock.flush();
    // Only the new frame scrolled — the cancelled one never wrote scrollTop.
    expect(scrollTopWrites).toBe(1);
  });

  test("a pending keyboard rAF is cancelled on unmount", () => {
    viewportMock.state.keyboardOpen = true;
    viewportMock.state.height = 500;
    viewportMock.state.offsetTop = 0;

    const { unmount } = render(panel());
    expect(rafMock.pending()).toBe(1);

    unmount();
    expect(rafMock.pending()).toBe(0);
    // Flushing the (now empty) queue runs nothing — the frame never executes.
    expect(rafMock.flush()).toBe(0);
  });
});
