import { HjemPageClient } from "@/components/cobalt/hjem/HjemPageClient";
import { auth } from "@/lib/auth";
import { buildHomeView } from "@/lib/cobalt/hjem";
import { getDashboardActivities } from "@/lib/db/queries";

// Hjem (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities),
// visitors — and signed-in users with no synced runs yet — get the demo
// fixtures. Mirrors app/(app)/coach/page.tsx. The client wrapper owns the
// loading choreography + entrance animations.
//
// force-dynamic: every value is relative to the clock and the session, so
// every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function HjemPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const activities = userId ? await getDashboardActivities(userId) : [];
  const view = activities.length > 0 ? buildHomeView(activities) : buildHomeView();

  return <HjemPageClient view={view} />;
}
