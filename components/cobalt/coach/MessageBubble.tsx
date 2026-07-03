import type { ChatMessage } from "@/lib/cobalt/coach";
import { cn } from "@/lib/utils";

// One chat bubble. Coach = frosted white glass, radius 18/18/18/6 (tail bottom-
// left). User = cobalt fill with silver text, radius 18/18/6/18 (tail bottom-
// right). Each new bubble slides in with the fadeUp entrance.
export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] px-[18px] py-[14px] text-[14.5px] leading-[1.55]",
          "[animation:cg-fade-up_0.4s_ease_both] motion-reduce:[animation:none]",
          "shadow-[0_4px_18px_rgba(27,41,192,0.08)]",
          isUser
            ? "rounded-[18px_18px_6px_18px] border border-cobalt/90 bg-cobalt text-silver"
            : "rounded-[18px_18px_18px_6px] border border-white/85 bg-white/60 text-cobalt"
        )}
      >
        {message.text}
      </div>
    </div>
  );
}
