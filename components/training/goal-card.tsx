"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { type Goal, ZONE_COLOR } from "@/lib/training/goals";
import { cn } from "@/lib/utils";
import { GOAL_ICON } from "./goal-icon";

/** localStorage key for the committed training goal — mirrors the
 * `stride-demo-mode` naming convention used elsewhere for client state. */
export const GOAL_STORAGE_KEY = "stride-goal";

interface GoalCardProps {
  goal: Goal;
}

/** A single selectable plan tile. Lifts on hover; on click it persists the
 * chosen goal to localStorage and routes to the committed training dashboard. */
export function GoalCard({ goal }: GoalCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const Icon = GOAL_ICON[goal.key];

  function handleSelect() {
    try {
      localStorage.setItem(GOAL_STORAGE_KEY, goal.key);
    } catch {
      // localStorage can throw in private mode — the query param still carries
      // the choice, so selection works regardless.
    }
    startTransition(() => {
      router.push(`/dashboard/training?goal=${goal.key}`);
    });
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={isPending}
      aria-label={`Choose plan: ${goal.title}`}
      className={cn(
        "group flex flex-col gap-5 rounded-[20px] border border-border bg-card p-6 text-left shadow-float",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-1 hover:border-volt/40 hover:shadow-volt",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-bg-2 text-volt transition-colors group-hover:border-volt/40">
          <Icon className="size-6" />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-fg">{goal.title}</h2>
        <p className="text-sm text-sub">{goal.desc}</p>
      </div>

      {/* FOCUS zone band */}
      <div className="mt-auto flex flex-col gap-2">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted">
          Focus
        </span>
        <div className="flex h-2.5 gap-1.5">
          {goal.band.map((zone) => (
            <span
              key={zone}
              className="flex-1 rounded-pill"
              style={{ backgroundColor: ZONE_COLOR[zone] }}
              title={zone.toUpperCase()}
            />
          ))}
        </div>
      </div>
    </button>
  );
}
