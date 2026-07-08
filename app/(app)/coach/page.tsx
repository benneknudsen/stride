import { CoachPageClient } from "@/components/cobalt/coach/CoachPageClient";
import { auth } from "@/lib/auth";
import { computeCoachDashboard } from "@/lib/coach/dashboard-data";
import { buildCoachView, buildLiveCoachView } from "@/lib/cobalt/coach";
import { demoActivities } from "@/lib/demo/data";

// Coach (issue #75) — a Server Component that builds the view-model per
// request: authenticated users get the live view (recommender + progression
// engine via computeCoachDashboard), visitors get the scripted demo fallback.
// The client wrapper owns the loading overlay + entrance animations.
//
// force-dynamic: the recommendation and load status depend on the clock and
// the session, so every request computes fresh data (mirrors /dashboard/coach).
export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const session = await auth();

  const view = session?.user
    ? buildLiveCoachView(computeCoachDashboard(), demoActivities)
    : buildCoachView();

  return <CoachPageClient view={view} />;
}
