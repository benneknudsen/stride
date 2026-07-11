import { HjemPageClient } from "@/components/cobalt/hjem/HjemPageClient";
import { auth } from "@/lib/auth";
import { buildHomeView } from "@/lib/cobalt/hjem";
import { getDashboardActivities, getRacePlan, getStravaTokens } from "@/lib/db/queries";

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
  const user = session?.user;
  const userId = user?.id;

  const [activities, racePlan, stravaTokens] = userId
    ? await Promise.all([
        getDashboardActivities(userId),
        getRacePlan(userId),
        getStravaTokens(userId),
      ])
    : [[], null, null];
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
      signedIn={userId !== undefined}
    />
  );
}
