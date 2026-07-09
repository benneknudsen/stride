import { PlanPageClient } from "@/components/cobalt/plan/PlanPageClient";
import { auth } from "@/lib/auth";
import { buildPlanView } from "@/lib/cobalt/plan";
import { getDashboardActivities } from "@/lib/db/queries";

// Plan (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities) behind
// the plan's live parts (week of plan, countdown), visitors — and signed-in
// users with no synced runs yet — get the demo fixtures. Mirrors
// app/(app)/coach/page.tsx. The client wrapper owns the loading overlay +
// entrance animations.
//
// force-dynamic: the countdown and week-of-plan are relative to the clock and
// the session, so every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const activities = userId ? await getDashboardActivities(userId) : [];
  const view = activities.length > 0 ? buildPlanView(activities) : buildPlanView();

  return <PlanPageClient view={view} />;
}
