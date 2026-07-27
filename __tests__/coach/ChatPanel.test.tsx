/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ChatPanel } from "@/components/cobalt/coach/ChatPanel";
import { ROUTES } from "@/lib/routes";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const initialMessages = [
  { id: "m1", role: "coach" as const, text: "Godmorgen!" },
  { id: "m2", role: "user" as const, text: "Hvordan ser min uge ud?" },
];

const prompts = ["Analysér min uge", "Foreslå næste pas"];

describe("ChatPanel — HTTP status error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
