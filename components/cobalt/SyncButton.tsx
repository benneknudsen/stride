"use client";

import { cn } from "@/lib/utils";

export type SyncState = "idle" | "syncing" | "synced" | "error";

// Sync control with four states. Controlled: the parent owns `state` and fires
// `onSync` on click; the parent flips the state on the API response and drops
// "synced"/"error" back to "idle" so the button stays usable (#97).
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
        style={{ borderColor: "color-mix(in srgb, var(--color-cobalt) 25%, transparent)" }}
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
        style={{ borderColor: "color-mix(in srgb, var(--color-success) 35%, transparent)" }}
      >
        <span className="size-[7px] rounded-full bg-success" />
        SYNCED
      </span>
    );
  }

  // A failed sync stays clickable — it's the retry affordance, not a dead label.
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onSync}
        className={cn(
          "cg-interactive inline-flex items-center gap-2 rounded-pill border px-4 py-2 font-cg-mono text-[11px] tracking-[0.08em] text-red transition-colors hover:bg-red/8",
          className
        )}
        style={{ borderColor: "color-mix(in srgb, var(--color-red) 35%, transparent)" }}
      >
        <span className="size-[7px] rounded-full bg-red" />
        PRØV IGEN
      </button>
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
      style={{ boxShadow: "0 6px 20px color-mix(in srgb, var(--color-cobalt) 25%, transparent)" }}
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
