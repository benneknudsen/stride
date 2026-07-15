import { HjemPageClient } from "@/components/cobalt/hjem/HjemPageClient";
import { VelkommenPage } from "@/components/cobalt/velkommen/VelkommenPage";
import { auth } from "@/lib/auth";
import { buildHomeView } from "@/lib/cobalt/hjem";
import {
  getDashboardActivities,
  getGarminTokens,
  getRacePlan,
  getStravaTokens,
} from "@/lib/db/queries";

// Hjem (issue #84) — a Server Component that builds the view-model per
// request: authenticated users get live data (getDashboardActivities) and
// their own race (getRacePlan, issue #99), visitors — and signed-in users
// with no synced runs yet — get the demo fixtures. Mirrors
// app/(app)/coach/page.tsx. The client wrapper owns the loading choreography
// + entrance animations.
//
// A visitor without `?demo=1` gets the Velkommen landing page instead of the
// demo dashboard, so the first thing a new visitor meets is the pitch — the
// demo itself stays one click away (DEMO_HOME_ROUTE), and the three other
// pages remain public with their own demo fallbacks (#100).
//
// force-dynamic: every value is relative to the clock and the session, so
// every request computes fresh data.
export const dynamic = "force-dynamic";

export default async function HjemPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const [session, { demo }] = await Promise.all([auth(), searchParams]);
  const user = session?.user;
  const userId = user?.id;

  if (!userId && demo === undefined) {
    return <VelkommenPage />;
  }

  const [activities, racePlan, stravaTokens, garminTokens] = userId
    ? await Promise.all([
        getDashboardActivities(userId),
        getRacePlan(userId),
        getStravaTokens(userId),
        getGarminTokens(userId),
      ])
    : [[], null, null, null];
  const raceDate = racePlan?.raceDate ?? undefined;
  const raceName = racePlan?.raceName ?? (raceDate ? "Din race" : undefined);

  const view = buildHomeView(
    activities.length > 0 ? activities : undefined,
    new Date(),
    raceDate,
    raceName
  );

  return (
    <HjemPageClient
      view={view}
      userName={user?.name?.trim() || user?.email?.split("@")[0] || undefined}
      stravaConnected={stravaTokens !== null}
      garminConnected={garminTokens !== null}
      signedIn={userId !== undefined}
      isDemo={userId === undefined && demo !== undefined}
    />
  );
}
