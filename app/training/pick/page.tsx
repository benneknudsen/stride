import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GoalCard } from "@/components/training/goal-card";
import { GOAL_LIST } from "@/lib/training/goals";

export const metadata: Metadata = {
  title: "Pick your plan · Stride",
};

/** Plan-selection screen: four goal cards. Picking one stores the goal and
 * routes to the committed training dashboard. */
export default function PickPlanPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      <header className="mt-6 flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-fg">Pick your plan</h1>
        <p className="max-w-prose text-sm text-sub">
          Choose the goal that fits where you are right now. Stride tailors your next run, weekly
          structure, and fit verdict to the plan you pick.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GOAL_LIST.map((goal) => (
          <GoalCard key={goal.key} goal={goal} />
        ))}
      </div>
    </main>
  );
}
