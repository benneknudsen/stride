import { HjemPageClient } from "@/components/cobalt/hjem/HjemPageClient";
import { auth } from "@/lib/auth";
import { buildHomeView } from "@/lib/cobalt/hjem";
import { getDashboardActivities, getRacePlan } from "@/lib/db/queries";

// Hjem (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities) and
// their own race (getRacePlan, issue #99), visitors — and signed-in users
// with no synced runs yet — get the demo fixtures. Mirrors
// app/(app)/coach/page.tsx. The client wrapper owns the loading choreography
// + entrance animations.
//
// force-dynamic: every value is relative to the clock and the session, so
// every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function HjemPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [activities, racePlan] = userId
    ? await Promise.all([getDashboardActivities(userId), getRacePlan(userId)])
    : [[], null];
  const raceDate = racePlan?.raceDate ?? undefined;
  const raceName = racePlan?.raceName ?? (raceDate ? "Din race" : undefined);

  const view = buildHomeView(
    activities.length > 0 ? activities : undefined,
    new Date(),
    raceDate,
    raceName
  );

  return <HjemPageClient view={view} />;
}
