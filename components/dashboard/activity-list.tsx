import { Activity as ActivityIcon, Zap } from "lucide-react";
import { ActivityRow } from "@/components/dashboard/activity-row";
import { ConnectStravaButton } from "@/components/dashboard/connect-strava-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getActivities, getStravaTokens } from "@/lib/db/queries";

export async function ActivityList() {
  const session = await auth();
  const userId = session?.user?.id;
  const [tokens, recentActivities] = userId
    ? await Promise.all([getStravaTokens(userId), getActivities(userId, { limit: 8 })])
    : [null, []];
  const stravaConnected = tokens !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activities</CardTitle>
      </CardHeader>
      <CardContent>
        {recentActivities.length === 0 ? (
          stravaConnected ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activities yet"
              description="Your runs will show up here once your next Strava sync completes."
            />
          ) : (
            <EmptyState
              icon={Zap}
              title="Connect Strava"
              description="Link your Strava account to sync your runs and unlock AI-powered insights."
              action={<ConnectStravaButton />}
            />
          )
        ) : (
          recentActivities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              href={`/dashboard/activity/${activity.id}`}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
