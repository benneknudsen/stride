"use client";

import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/cobalt/coach/MessageBubble";
import type { ChatMessage, CoachView } from "@/lib/cobalt/coach";
import type { ChatMessage as ApiChatMessage, ChatReply } from "@/types/chat";

// Left column: the chat UI. Owns its own transcript, draft and typing state.
// Sending a message (typed, or via a quick-prompt chip) appends the user
// bubble, shows the 3-dot typing indicator and streams the coach's answer from
// /api/ai/chat — NDJSON, one `ChatReply` fragment per line, concatenated into
// a single coach bubble when the stream ends. On failure an error bubble with
// a "Prøv igen" button re-sends the same transcript.
export function ChatPanel({
  initialMessages,
  prompts,
}: {
  initialMessages: CoachView["initialMessages"];
  prompts: CoachView["prompts"];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight stream when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view as the transcript grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/typing/failed are the scroll triggers, not read in the body
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, failed]);

  /** Panel transcript → the role/content shape the chat route expects. */
  const toApiMessages = (transcript: ChatMessage[]): ApiChatMessage[] =>
    transcript.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

  /** One NDJSON line → its `content` fragment ("" for blanks and junk). */
  const parseLine = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    try {
      const reply = JSON.parse(trimmed) as ChatReply;
      return typeof reply.content === "string" ? reply.content : "";
    } catch {
      return "";
    }
  };

  /** POST the transcript, accumulate the stream, land it as one coach bubble. */
  const streamReply = async (transcript: ChatMessage[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setFailed(false);
    setTyping(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toApiMessages(transcript) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          answer += parseLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      answer += parseLine(buffer);
      if (!answer.trim()) throw new Error("empty_reply");

      idRef.current += 1;
      setMessages((prev) => [...prev, { id: `c${idRef.current}`, role: "coach", text: answer }]);
      setTyping(false);
    } catch {
      // Unmounted mid-stream — never touch state after abort.
      if (controller.signal.aborted) return;
      setTyping(false);
      setFailed(true);
    }
  };

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || typing) return;
    idRef.current += 1;
    const next: ChatMessage[] = [...messages, { id: `u${idRef.current}`, role: "user", text }];
    setMessages(next);
    setDraft("");
    void streamReply(next);
  };

  // The failed transcript already ends with the user's message — re-send as is.
  const retry = () => {
    if (typing) return;
    void streamReply(messages);
  };

  // The panel needs a bounded height, or it grows with the transcript and the
  // scroll container inside it never overflows — so `overflow-y-auto` never
  // engages and old messages become unreachable (#97).
  return (
    <div className="cg-glass flex h-[calc(100dvh-260px)] min-h-[560px] flex-col rounded-widget [animation:cg-fade-up_0.6s_0.08s_ease_both] motion-reduce:[animation:none] lg:h-[calc(100dvh-320px)]">
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 pt-6 pb-2.5"
      >
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {typing ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-[5px] rounded-[18px_18px_18px_6px] border border-white/85 bg-white/60 px-[18px] py-[14px]">
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

        {failed ? (
          <div className="flex justify-start">
            <div className="flex max-w-[82%] flex-col items-start gap-2.5 rounded-[18px_18px_18px_6px] border border-red/30 bg-white/60 px-[18px] py-[14px] text-[13.5px] leading-relaxed text-ink">
              Coachen kunne ikke svare lige nu. Tjek din forbindelse og prøv igen.
              <button
                type="button"
                onClick={retry}
                className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
              >
                Prøv igen
              </button>
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
            onClick={() => send(prompt)}
            className="cg-interactive rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input pill + round send button */}
      <div className="flex gap-2.5 border-t border-cobalt/12 px-[18px] pt-3.5 pb-[18px]">
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
        <button
          type="button"
          onClick={() => send()}
          aria-label="Send besked"
          className="cg-interactive flex size-[46px] flex-none items-center justify-center rounded-full bg-cobalt text-silver transition-colors hover:bg-cobalt-light"
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
      </div>
    </div>
  );
}
