"use client";

import { track } from "@vercel/analytics";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export type SyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "partial"
  | "busy"
  | "error"
  | "rate_limited";

/** The status pills — everything that reports instead of offering a click. */
type StatusLook = {
  /** The Danish word on the pill. */
  label: string;
  /** Text colour. */
  text: string;
  /** The pill's border colour. */
  border: string;
  /** The dot's classes, on top of the shared dot geometry. */
  dot: string;
};

const STATUS: Partial<Record<SyncState, StatusLook>> = {
  syncing: {
    label: "SYNCER…",
    text: "text-cobalt",
    border: "color-mix(in srgb, var(--color-cobalt) 25%, transparent)",
    dot: "bg-red animate-[cg-pulse-dot_0.8s_ease-in-out_infinite] motion-reduce:animate-none",
  },
  synced: {
    label: "SYNCED",
    text: "text-success-ink",
    border: "color-mix(in srgb, var(--color-success) 35%, transparent)",
    dot: "bg-success",
  },
  // The sync only covered part of the history (#338). "SYNCED" would be a lie
  // about the account's history, so it says what actually happened.
  partial: {
    label: "DELVIS SYNKET",
    text: "text-cobalt",
    border: "color-mix(in srgb, var(--color-cobalt) 25%, transparent)",
    dot: "bg-cobalt",
  },
  // Another sync for this account is already running (#338) — the work is
  // happening, so this is a calm status, not the red retry button.
  busy: {
    label: "SYNCER ALLEREDE",
    text: "text-ink",
    border: "color-mix(in srgb, var(--color-ink) 25%, transparent)",
    dot: "bg-ink/50",
  },
  // Strava's own API refused a fresh pull (429). That is not a failure the user
  // can fix by retrying, so it reads as a calm status, not the red retry button.
  rate_limited: {
    label: "KØRTE FOR NYLIG",
    text: "text-ink",
    border: "color-mix(in srgb, var(--color-ink) 25%, transparent)",
    dot: "bg-ink/50",
  },
};

// Sync control with seven states. Controlled: the parent owns `state` and fires
// `onSync` on click; the parent flips the state on the API response and drops
// "synced"/"error" back to "idle" so the button stays usable (#97). "partial"
// and "busy" are statuses the parent reads off the response (#338): a sync
// that only covered part of the history is not a "synced" account, and a sync
// that lost the race for the account lock is a status, not a failure.
export function SyncButton({
  state,
  onSync,
  className,
}: {
  state: SyncState;
  onSync?: () => void;
  className?: string;
}) {
  // Anonymous analytics: a sync reaching the "synced" state means the parent's
  // fetch succeeded. Keyed on state so it fires once per completed sync (the
  // state drops back to "idle" after the terminal window), no PII attached.
  useEffect(() => {
    if (state === "synced") track("sync_udført");
  }, [state]);

  const status = STATUS[state];
  if (status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-pill border px-4 py-2 font-cg-mono text-[11px] tracking-[0.08em]",
          status.text,
          className
        )}
        style={{ borderColor: status.border }}
      >
        <span className={cn("size-[7px] rounded-full", status.dot)} />
        {status.label}
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
      Synkronisér
    </button>
  );
}
