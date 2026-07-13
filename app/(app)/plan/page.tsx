import { PlanPageClient } from "@/components/cobalt/plan/PlanPageClient";
import { auth } from "@/lib/auth";
import { buildPlanView } from "@/lib/cobalt/plan";
import { getDashboardActivities, getRacePlan } from "@/lib/db/queries";

// Plan (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities) behind
// the plan's live parts (week of plan, countdown) and their own race
// (getRacePlan, issue #99 — phases, markers and the race card re-anchor to
// it), visitors — and signed-in users with no synced runs yet — get the demo
// fixtures. Signed-in users without a chosen race see the demo plan plus a
// "vælg din egen race" CTA; the page always demonstrates the product. Mirrors
// app/(app)/coach/page.tsx. The client wrapper owns the loading overlay +
// entrance animations.
//
// force-dynamic: the countdown and week-of-plan are relative to the clock and
// the session, so every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [activities, racePlan] = userId
    ? await Promise.all([getDashboardActivities(userId), getRacePlan(userId)])
    : [[], null];
  const raceDate = racePlan?.raceDate ?? undefined;
  const raceName = racePlan?.raceName ?? (raceDate ? "Din race" : undefined);

  // Data-driven (issue #115): a runner with synced runs *and* a race of their own
  // gets a week derived from their own data — sessions from the phase engine,
  // volume from their load ratio, pace targets from the race predictor. Everyone
  // else (visitors, and signed-in users still on the demo plan) gets the template.
  const live = activities.length > 0 && !!raceDate;

  const view = buildPlanView(
    activities.length > 0 ? activities : undefined,
    new Date(),
    raceDate,
    raceName,
    live
  );

  return <PlanPageClient view={view} canEditRace={!!userId} hasOwnRace={!!raceDate} />;
}
