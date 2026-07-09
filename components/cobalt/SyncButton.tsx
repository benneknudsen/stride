"use client";

import { cn } from "@/lib/utils";

export type SyncState = "idle" | "syncing" | "synced";

// Sync control with three states. Controlled: the parent owns `state` and fires
// `onSync` on click (the real flow flips state on the API response; the demo
// nav simulates ~1.8s).
export function SyncButton({
  state,
  onSync,
  className,
}: {
  state: SyncState;
  onSync?: () => void;
  className?: string;
}) {
  if (state === "syncing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-pill border px-4 py-2 font-cg-mono text-[11px] tracking-[0.08em] text-cobalt",
          className
        )}
        style={{ borderColor: "rgba(27, 41, 192, 0.25)" }}
      >
        <span className="size-[7px] animate-[cg-pulse-dot_0.8s_ease-in-out_infinite] rounded-full bg-red motion-reduce:animate-none" />
        SYNCER…
      </span>
    );
  }

  if (state === "synced") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-pill border px-4 py-2 font-cg-mono text-[11px] tracking-[0.08em] text-success-ink",
          className
        )}
        style={{ borderColor: "rgba(43, 168, 74, 0.35)" }}
      >
        <span className="size-[7px] rounded-full bg-success" />
        SYNCED
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSync}
      className={cn(
        "cg-interactive inline-flex items-center gap-2 rounded-pill bg-cobalt px-[18px] py-2 text-[12.5px] font-semibold text-silver transition-colors hover:bg-cobalt-light",
        className
      )}
      style={{ boxShadow: "0 6px 20px rgba(27, 41, 192, 0.25)" }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 12 A8 8 0 1 1 17.5 6"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M17.5 2.5 V6.5 H13.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sync now
    </button>
  );
}
