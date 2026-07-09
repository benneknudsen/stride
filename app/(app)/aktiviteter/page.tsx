import { AktiviteterPageClient } from "@/components/cobalt/aktiviteter/AktiviteterPageClient";
import { auth } from "@/lib/auth";
import { buildActivitiesView } from "@/lib/cobalt/aktiviteter";
import { getDashboardActivities } from "@/lib/db/queries";

// Aktiviteter (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities),
// visitors — and signed-in users with no synced runs yet — get the demo
// fixtures. Mirrors app/(app)/coach/page.tsx. The client wrapper owns the
// loading overlay + filter state.
//
// force-dynamic: the month window and row meta labels are relative to the
// clock and the session, so every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function AktiviteterPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const activities = userId ? await getDashboardActivities(userId) : [];
  const view = activities.length > 0 ? buildActivitiesView(activities) : buildActivitiesView();

  return <AktiviteterPageClient view={view} />;
}
