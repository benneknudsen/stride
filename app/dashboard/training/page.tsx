import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LastRunsSection } from "@/components/training/last-runs-section";
import { LatestRunSection } from "@/components/training/latest-run-section";
import { NextRunSection } from "@/components/training/next-run-section";
import { PlanBanner } from "@/components/training/plan-banner";
import { GOALS, type GoalKey } from "@/lib/training/goals";
import { getTrainingData } from "@/lib/training/runs";

interface TrainingPageProps {
  searchParams: Promise<{ goal?: string }>;
}

function resolveGoal(raw: string | undefined) {
  if (raw && raw in GOALS) return GOALS[raw as GoalKey];
  return null;
}

export async function generateMetadata({ searchParams }: TrainingPageProps): Promise<Metadata> {
  const goal = resolveGoal((await searchParams).goal);
  return { title: goal ? `${goal.title} · Training · Stride` : "Training · Stride" };
}

/**
 * Committed training dashboard. Reads the chosen `GoalKey` from `?goal=`, then
 * renders the plan against seeded run data: latest run + fit, recent form, and
 * the recommended next run. An unknown or missing goal routes back to the
 * picker so the page always has a committed plan to render.
 */
export default async function TrainingPage({ searchParams }: TrainingPageProps) {
  const goal = resolveGoal((await searchParams).goal);
  if (!goal) redirect("/training/pick");

  const { latest, runs, trend, drivers } = getTrainingData(goal);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <PlanBanner goal={goal} />
      <LatestRunSection goal={goal} latest={latest} />
      <LastRunsSection trend={trend} runs={runs} />
      <NextRunSection goal={goal} drivers={drivers} />
    </main>
  );
}
