"use client";

import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/cobalt/coach/MessageBubble";
import type { ChatMessage, CoachView } from "@/lib/cobalt/coach";

// Left column: the chat UI. Owns its own transcript, draft and typing state.
// Sending a message appends the user bubble, shows the 3-dot typing indicator,
// then appends the next cycled coach reply after ~1.4s. Quick-prompt chips send
// canned questions; Enter or the round send button sends the draft.
export function ChatPanel({
  initialMessages,
  prompts,
  replies,
}: {
  initialMessages: CoachView["initialMessages"];
  prompts: CoachView["prompts"];
  replies: CoachView["replies"];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const replyIx = useRef(0);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    },
    []
  );

  // Keep the newest message in view as the transcript grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/typing are the scroll triggers, not read in the body
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || typing) return;
    idRef.current += 1;
    const userMsg: ChatMessage = { id: `u${idRef.current}`, role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setTyping(true);
    const reply = replies[replyIx.current % replies.length];
    replyIx.current += 1;
    replyTimer.current = setTimeout(() => {
      idRef.current += 1;
      setMessages((prev) => [...prev, { id: `c${idRef.current}`, role: "coach", text: reply }]);
      setTyping(false);
    }, 1400);
  };

  return (
    <div className="cg-glass flex min-h-[560px] flex-col rounded-widget [animation:cg-fade-up_0.6s_0.08s_ease_both] motion-reduce:[animation:none]">
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
      </div>

      {/* Quick-prompt chips */}
      <div className="flex flex-wrap gap-2 px-6 pt-2 pb-3">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => send(prompt)}
            className="rounded-pill border border-cobalt/28 bg-white/40 px-[15px] py-[7px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
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
            if (e.key === "Enter") send();
          }}
          placeholder="Skriv til din coach…"
          aria-label="Skriv til din coach"
          className="min-w-0 flex-1 rounded-pill border border-white/90 bg-white/65 px-5 py-[13px] font-cg-sans text-[14.5px] text-cobalt outline-none placeholder:text-ink/70 focus:border-cobalt/40"
        />
        <button
          type="button"
          onClick={() => send()}
          aria-label="Send besked"
          className="flex size-[46px] flex-none items-center justify-center rounded-full bg-cobalt text-silver transition-colors hover:bg-cobalt-light"
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
