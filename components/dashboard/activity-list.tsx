import { Activity as ActivityIcon, Zap } from "lucide-react";
import { ActivityRow } from "@/components/dashboard/activity-row";
import { ConnectStravaButton } from "@/components/dashboard/connect-strava-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardActivity } from "@/lib/db/queries";

export function ActivityList({
  activities,
  stravaConnected,
}: {
  activities: DashboardActivity[];
  stravaConnected: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activities</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
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
          activities.map((activity) => (
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
