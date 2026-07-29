"use client";

import { createId } from "@paralleldrive/cuid2";
import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState } from "react";
import { clearChatHistory } from "@/actions/chat";
import { MessageBubble } from "@/components/cobalt/coach/MessageBubble";
import type { ChatMessage, CoachView } from "@/lib/cobalt/coach";
import { ROUTES } from "@/lib/routes";
import type { ChatMessage as ApiChatMessage, ChatBlock, ChatReply } from "@/types/chat";

/** Why the chat request failed — drives the error bubble copy. */
type FailureKind = "network" | "unauthorized" | "rate_limited";

interface ChatFailure {
  kind: FailureKind;
  retryAfter?: number;
}

/** Format `retry-after` seconds into a short Danish phrase. */
function formatRetryAfter(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "lidt";
  if (seconds < 60) return `${seconds} sekunder`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minut${minutes === 1 ? "" : "ter"}`;
}

/** Scroll-to-bottom threshold: auto-scroll only when this close to the bottom. */
const SCROLL_THRESHOLD_PX = 80;

/** The question the visitor autoplay demo plays once (issue #235). Must be a key
 *  in `demoReplies` so the reply (text + a clickable ActivityCard) exists. */
const AUTOPLAY_PROMPT = "Analysér min uge";
/** Typing-indicator beat before the autoplay coach reply lands. */
const AUTOPLAY_TYPING_MS = 800;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX;
}

// Left column: the chat UI. Owns its own transcript, draft and streaming state.
// Sending a message (typed, or via a quick-prompt chip) appends the user
// bubble, shows the 3-dot typing indicator and streams the coach's answer from
// /api/ai/chat — NDJSON, one `ChatReply` fragment per line. The first fragment
// swaps the typing indicator for an empty coach bubble; each further fragment
// grows that bubble's text live, so the answer appears as it arrives. On
// failure an error bubble with a "Prøv igen" button re-sends the same
// transcript.
export function ChatPanel({
  initialMessages,
  prompts,
  visitor = false,
  demoReplies,
}: {
  initialMessages: CoachView["initialMessages"];
  prompts: CoachView["prompts"];
  /**
   * Signed-out visitor (issue #203). The coach page is intentionally not
   * auth-gated (#100), so a visitor sees the whole panel — but /api/ai/chat is
   * session-gated. In visitor mode the composer becomes a login-CTA and chip
   * taps show a scripted `demoReplies` answer instead of firing a request that
   * can only 401. Signed-in users keep the live chat unchanged.
   */
  visitor?: boolean;
  /** Scripted coach answer per chip label — used only in visitor mode. */
  demoReplies?: CoachView["demoReplies"];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [typing, setTyping] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight stream when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Focus the error bubble when it appears so screen-reader users notice it.
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  // Scroll to the bottom on first render, then only when the user is already
  // near the bottom — never rip them back up while reading older messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/typing/failure are the scroll triggers, not read in the body
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottom(el)) el.scrollTop = el.scrollHeight;
  }, [messages, typing, failure]);

  // Visitor autoplay (issue #235): the demo chat is otherwise silent until a chip
  // is tapped, so a visitor might never see a coach turn carrying real
  // generative-UI cards. When the panel first scrolls into view we play ONE
  // scripted exchange — the "Analysér min uge" question and its reply (text + a
  // clickable ActivityCard) — so the card moment is visible without any tap. It
  // fires once, never loops, and leaves the quick-prompt chips fully working.
  // Reduced-motion visitors get the exchange immediately, without the typing beat.
  const autoplayedRef = useRef(false);
  useEffect(() => {
    if (!visitor || autoplayedRef.current) return;
    // No IntersectionObserver (older WebView / jsdom) → skip the reveal rather
    // than fabricate one; the chips still demo the same replies on tap.
    if (typeof IntersectionObserver === "undefined") return;
    const reply = demoReplies?.[AUTOPLAY_PROMPT];
    const el = scrollRef.current;
    if (!reply || !el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const play = () => {
      if (autoplayedRef.current) return;
      autoplayedRef.current = true;
      idRef.current += 1;
      const userTurn: ChatMessage = {
        id: `u${idRef.current}`,
        role: "user",
        text: AUTOPLAY_PROMPT,
      };
      idRef.current += 1;
      const coachTurn: ChatMessage = {
        id: `c${idRef.current}`,
        role: "coach",
        text: reply.text,
        blocks: reply.blocks ?? [],
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setMessages((prev) => [...prev, userTurn, coachTurn]);
        return;
      }
      setMessages((prev) => [...prev, userTurn]);
      setTyping(true);
      timer = setTimeout(() => {
        setTyping(false);
        setMessages((prev) => [...prev, coachTurn]);
      }, AUTOPLAY_TYPING_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry?.isIntersecting) {
          play();
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [visitor, demoReplies]);

  // Panel transcript → the role/content shape the chat route expects. Synthetic
  // turns (the scripted opening bubble) are dropped so the coach's own greeting
  // never becomes model context and no fabricated user turn is ever sent as if
  // the visitor wrote it (issue #201). The client-generated id is forwarded for
  // idempotent retries (issue #205).
  const toApiMessages = (transcript: ChatMessage[]): ApiChatMessage[] =>
    transcript
      .filter((m) => !m.synthetic)
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
        ...(m.clientId ? { clientMessageId: m.clientId } : {}),
      }));

  /**
   * One NDJSON line → a parsed fragment: a text token, a generative-UI block, or
   * null for blanks and junk. Backward-compatible (issue #221): a legacy line
   * with no `type` field is read as text via its `content`, so an old stream
   * still renders as before.
   */
  type ParsedFragment = { kind: "text"; text: string } | { kind: "block"; block: ChatBlock };

  const parseLine = (line: string): ParsedFragment | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const reply = JSON.parse(trimmed) as ChatReply | { content?: unknown };
      if ("type" in reply && reply.type === "block") {
        return { kind: "block", block: reply.block };
      }
      // type === "text", or a legacy line with no `type` at all.
      const content = (reply as { content?: unknown }).content;
      return typeof content === "string" ? { kind: "text", text: content } : null;
    } catch {
      return null;
    }
  };

  /** Fold NDJSON lines into an accumulated answer + block list. */
  const foldFragments = (
    lines: string[],
    answer: string,
    blocks: ChatBlock[]
  ): { answer: string; blocks: ChatBlock[] } => {
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed?.kind === "text") answer += parsed.text;
      else if (parsed?.kind === "block") blocks.push(parsed.block);
    }
    return { answer, blocks };
  };

  /** POST the transcript, stream the coach's answer live into one coach bubble. */
  const streamReply = async (transcript: ChatMessage[]) => {
    // Explicitly abort any previous stream before starting a new one, so two
    // answers can never grow side-by-side (issue #205).
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setFailure(null);
    setStreaming(true);
    setTyping(true);
    // Reserve this coach turn's id up-front so every fragment update targets
    // the same bubble.
    idRef.current += 1;
    const assistantTurnId = `c${idRef.current}`;
    let started = false;

    const finish = () => {
      // Only the stream that currently owns the controller may touch state.
      if (abortRef.current !== controller) return;
      setStreaming(false);
      setTyping(false);
      abortRef.current = null;
    };

    // Render the answer-so-far: the first fragment (text or block) drops the
    // typing indicator and appends the coach bubble; later fragments patch it.
    // Blocks are passed as a fresh array each time so React sees a new reference.
    const render = (answer: string, blocks: ChatBlock[]) => {
      if (!answer && blocks.length === 0) return; // nothing yet — keep typing dots
      if (!started) {
        started = true;
        setTyping(false);
        setMessages((prev) => [
          ...prev,
          { id: assistantTurnId, role: "coach", text: answer, blocks: [...blocks] },
        ]);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantTurnId ? { ...m, text: answer, blocks: [...blocks] } : m
        )
      );
    };

    const reportFailure = (kind: FailureKind, retryAfter?: number) => {
      if (abortRef.current !== controller) return;
      setFailure({ kind, retryAfter });
      finish();
      Sentry.captureException(new Error(`ChatPanel request failed: ${kind}`), {
        tags: { context: "coach.chat.client" },
        extra: { kind, retryAfter },
      });
    };

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toApiMessages(transcript) }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 401) {
          reportFailure("unauthorized");
          return;
        }
        if (res.status === 429) {
          const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
          reportFailure("rate_limited", Number.isFinite(retryAfter) ? retryAfter : undefined);
          return;
        }
        reportFailure("network");
        return;
      }

      // Some WebViews/proxies strip the streaming body even on a 200. Fall back
      // to reading the full NDJSON text and stitching the answer together.
      if (!res.body) {
        const text = await res.text();
        const folded = foldFragments(text.split("\n"), "", []);
        if (!folded.answer.trim() && folded.blocks.length === 0) {
          reportFailure("network");
          return;
        }
        render(folded.answer, folded.blocks);
        finish();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      const blocks: ChatBlock[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const parsed = parseLine(buffer.slice(0, newline));
          if (parsed?.kind === "text") answer += parsed.text;
          else if (parsed?.kind === "block") blocks.push(parsed.block);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          render(answer, blocks);
        }
      }
      const tail = parseLine(buffer);
      if (tail?.kind === "text") answer += tail.text;
      else if (tail?.kind === "block") blocks.push(tail.block);
      if (!answer.trim() && blocks.length === 0) {
        reportFailure("network");
        return;
      }
      render(answer, blocks);
      finish();
    } catch {
      // Unmounted mid-stream or stopped by the user — never touch state after
      // abort unless this is still the active stream.
      if (abortRef.current !== controller) return;
      reportFailure("network");
    }
  };

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || streaming) return;
    const clientId = createId();
    idRef.current += 1;
    const next: ChatMessage[] = [
      ...messages,
      { id: `u${idRef.current}`, clientId, role: "user", text },
    ];
    setMessages(next);
    setDraft("");
    void streamReply(next);
  };

  // Visitor mode (issue #203): a chip tap never hits the network. Append the
  // visitor's question and its scripted answer straight into the transcript, so
  // the demo reads as a real exchange without ever provoking a 401.
  const sendDemo = (prompt: string) => {
    const reply = demoReplies?.[prompt];
    if (!reply) return;
    idRef.current += 1;
    const userTurn: ChatMessage = { id: `u${idRef.current}`, role: "user", text: prompt };
    idRef.current += 1;
    const coachTurn: ChatMessage = {
      id: `c${idRef.current}`,
      role: "coach",
      text: reply.text,
      blocks: reply.blocks ?? [],
    };
    setMessages((prev) => [...prev, userTurn, coachTurn]);
  };

  // The failed transcript already ends with the user's message — re-send as is.
  // The user turn carries the same clientId, so the route deduplicates if it
  // was already persisted (issue #205).
  const retry = () => {
    if (streaming) return;
    void streamReply(messages);
  };

  // Stop the current stream and clear the typing indicator.
  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setTyping(false);
  };

  const [clearing, setClearing] = useState(false);

  // "Ryd samtale nu" (issue #229): wipe the persisted history server-side, then
  // reset the panel to its opening bubble so the fresh start is immediate. Low
  // risk, so no confirmation dialog. Aborts any in-flight stream first.
  const clearConversation = async () => {
    if (clearing) return;
    setClearing(true);
    abortRef.current?.abort();
    setTyping(false);
    setFailure(null);
    const result = await clearChatHistory();
    if (result.ok) {
      // Reset to only the synthetic opening bubble — initialMessages contains
      // the full server-loaded history, which would still show the wiped
      // messages if we set it back to that.
      const opening = initialMessages.filter((m) => m.synthetic);
      setMessages(opening);
      setDraft("");
    }
    setClearing(false);
  };

  // After "Ryd samtale nu" (issue #232) only the synthetic opening bubble
  // remains. Show a centred placeholder so the wrapper never reads as an empty,
  // collapsed panel; it disappears the moment a real turn is appended.
  const hasRealMessages = messages.some((m) => !m.synthetic);

  // The panel needs a bounded height, or it grows with the transcript and the
  // scroll container inside it never overflows — so `overflow-y-auto` never
  // engages and old messages become unreachable (#97). On small viewports the
  // height is clamped so the composer stays visible without page scrolling.
  return (
    <div className="cg-glass flex max-h-[calc(100dvh-260px)] min-h-[220px] flex-col rounded-widget [animation:cg-fade-up_0.6s_0.08s_ease_both] motion-reduce:[animation:none] lg:max-h-[calc(100dvh-320px)]">
      {visitor ? (
        // Signed-out demo (issue #235): mark the whole panel as an example so the
        // scripted opener, the autoplayed exchange and the chip replies never read
        // as the visitor's own live data.
        <div className="flex items-center gap-2 border-b border-cobalt/10 px-6 pt-4 pb-2.5">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-red [animation:cg-pulse-dot_1.4s_ease-in-out_infinite] motion-reduce:[animation:none]"
          />
          <span className="cg-label text-[10.5px] font-semibold text-cobalt">
            AI-coachen · Eksempel
          </span>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 pt-6 pb-2.5"
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {!visitor && !hasRealMessages && !typing && !failure ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-[14px] text-ink/60">
              Din samtale er nulstillet. Stil et nyt spørgsmål nedenfor.
            </p>
          </div>
        ) : null}

        {typing ? (
          <div className="flex justify-start" role="status" aria-label="Coachen skriver">
            <div className="flex items-center gap-[5px] rounded-[18px_18px_18px_6px] border border-white/85 bg-white/60 px-[18px] py-[14px]">
              <span className="sr-only">Coachen skriver</span>
              {[0, 0.2, 0.4].map((delay) => (
                <span
                  key={delay}
                  className="size-[7px] rounded-full bg-ink [animation:cg-pulse-dot_1s_ease-in-out_infinite] motion-reduce:[animation:none]"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {failure ? (
          <div ref={failureRef} tabIndex={-1} role="alert" className="flex justify-start">
            <div className="flex max-w-[82%] flex-col items-start gap-2.5 rounded-[18px_18px_18px_6px] border border-red/30 bg-white/60 px-[18px] py-[14px] text-[13.5px] leading-relaxed text-ink">
              {failure.kind === "unauthorized" ? (
                <>
                  Log ind for at chatte med coachen.
                  <a
                    href={ROUTES.LOGIN}
                    className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
                  >
                    Log ind
                  </a>
                </>
              ) : failure.kind === "rate_limited" ? (
                <>
                  Du har sendt mange beskeder — prøv igen om {formatRetryAfter(failure.retryAfter)}.
                  <button
                    type="button"
                    onClick={retry}
                    className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
                  >
                    Prøv igen
                  </button>
                </>
              ) : (
                <>
                  Coachen kunne ikke svare lige nu. Tjek din forbindelse og prøv igen.
                  <button
                    type="button"
                    onClick={retry}
                    className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
                  >
                    Prøv igen
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Quick-prompt chips */}
      <div className="flex flex-wrap gap-2 px-6 pt-2 pb-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={streaming}
            onClick={() => (visitor ? sendDemo(prompt) : send(prompt))}
            className="cg-interactive disabled:cursor-not-allowed disabled:opacity-50 rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
          >
            {prompt}
          </button>
        ))}
      </div>

      {visitor ? (
        // Signed-out visitor (issue #203): don't offer a composer that can only
        // fail. An honest login-CTA replaces the input; the chips above still
        // demo scripted answers.
        <div className="flex flex-col items-start gap-2.5 border-t border-cobalt/12 px-[18px] pt-3.5 pb-[18px] text-[13.5px] text-ink">
          <span>Log ind for at chatte med din coach.</span>
          <a
            href={ROUTES.LOGIN}
            className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
          >
            Log ind
          </a>
        </div>
      ) : (
        /* Input pill + round send/stop button */
        <div className="border-t border-cobalt/12 px-[18px] pt-3.5 pb-[18px]">
          <div className="flex gap-2.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
              }}
              placeholder="Skriv til din coach…"
              aria-label="Skriv til din coach"
              className="min-w-0 flex-1 rounded-pill border border-white/90 bg-white/65 px-5 py-[13px] font-cg-sans text-[16px] text-cobalt outline-none placeholder:text-ink/70 focus:border-cobalt/40 sm:text-[14px]"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop svaret"
                className="cg-interactive flex size-[46px] flex-none items-center justify-center rounded-full bg-red text-silver transition-colors hover:bg-red/90"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                disabled={!draft.trim()}
                onClick={() => send()}
                aria-label="Send besked"
                className="cg-interactive disabled:cursor-not-allowed disabled:opacity-50 flex size-[46px] flex-none items-center justify-center rounded-full bg-cobalt text-silver transition-colors hover:bg-cobalt-light"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 12 L20 12 M20 12 L13 5 M20 12 L13 19"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
          {/* Retention notice + manual clear (issue #229). Signed-in only — a
              visitor has no persisted history to expire. */}
          <p className="mt-2.5 text-center text-[11px] text-ink/60">
            Din chat-historik slettes automatisk efter 24 timer.{" "}
            <button
              type="button"
              onClick={() => void clearConversation()}
              disabled={clearing}
              className="cg-interactive font-semibold text-cobalt underline underline-offset-2 transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Ryd samtale nu
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
