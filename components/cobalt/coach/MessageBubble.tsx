import { memo } from "react";
import { ActivityCard } from "@/components/cobalt/coach/ActivityCard";
import { ChatMarkdown } from "@/components/cobalt/coach/ChatMarkdown";
import { NextActivityCard } from "@/components/cobalt/coach-dashboard/NextActivityCard";
import { WorkoutCard } from "@/components/cobalt/coach-dashboard/WorkoutCard";
import type { ChatMessage } from "@/lib/cobalt/coach";
import { cn } from "@/lib/utils";

// One chat turn. Coach = frosted white glass, radius 18/18/18/6 (tail bottom-
// left). User = cobalt fill with silver text, radius 18/18/6/18 (tail bottom-
// right). Each new bubble slides in with the fadeUp entrance.
//
// A coach turn can also carry generative-UI blocks (issue #221): clickable
// activity cards, workout cards and variation cards (issue #258), built
// server-side from tool output. They
// render below the text so an answer reads "prose, then the cards it refers to";
// text and blocks can both appear in the same turn. A turn may be blocks-only
// (no text bubble) when the model let the cards speak for themselves.
// Wrapped in React.memo so only the turn that is actively streaming re-renders
// (and re-parses its markdown) as tokens arrive. streamReply patches state by
// replacing only the streaming turn's object (see ChatPanel.render) while every
// other turn keeps its previous reference, so their memoized bubbles bail out of
// re-render on shallow prop equality.
function MessageBubbleImpl({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const hasText = message.text.trim().length > 0;
  const blocks = message.blocks ?? [];

  // Stable, index-free keys: derive a signature from each block's content and
  // disambiguate the rare duplicate with an occurrence counter. Blocks are only
  // ever appended during a stream (never reordered), so this stays stable as the
  // list grows.
  const seen = new Map<string, number>();
  const keyedBlocks = blocks.map((block) => {
    const base =
      block.kind === "activity"
        ? `activity-${block.activity.id}`
        : block.kind === "workout"
          ? `workout-${block.workout.type}-${block.workout.distanceKm}`
          : `variation-${block.variation.type}-${block.variation.distanceKm}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { block, key: `${base}#${occurrence}` };
  });

  return (
    <div className={cn("flex flex-col gap-2.5", isUser ? "items-end" : "items-start")}>
      {hasText ? (
        <div
          className={cn(
            "max-w-[78%] px-[18px] py-[14px] text-[14.5px] leading-[1.55]",
            "[animation:cg-fade-up_0.4s_ease_both] motion-reduce:[animation:none]",
            "shadow-[0_4px_18px_color-mix(in_srgb,var(--color-cobalt)_8%,transparent)]",
            isUser
              ? "rounded-[18px_18px_6px_18px] border border-cobalt/90 bg-cobalt text-silver"
              : "rounded-[18px_18px_18px_6px] border border-white/85 bg-white/60 text-cobalt"
          )}
        >
          {isUser ? message.text : <ChatMarkdown text={message.text} />}
        </div>
      ) : null}

      {blocks.length > 0 ? (
        <div className="flex w-full max-w-[78%] flex-col gap-2.5 [animation:cg-fade-up_0.4s_ease_both] motion-reduce:[animation:none]">
          {keyedBlocks.map(({ block, key }) =>
            block.kind === "activity" ? (
              <ActivityCard key={key} activity={block.activity} />
            ) : block.kind === "workout" ? (
              <WorkoutCard key={key} workout={block.workout} />
            ) : (
              // The variation the coach offered instead of the standard pas
              // (issue #258) — the same card the dashboard shows.
              <NextActivityCard key={key} activity={block.variation} />
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
