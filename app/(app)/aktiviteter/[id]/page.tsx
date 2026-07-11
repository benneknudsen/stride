import { notFound } from "next/navigation";
import { ActivityDetailHeader } from "@/components/cobalt/aktivitet/ActivityDetailHeader";
import { ActivityRouteCard } from "@/components/cobalt/aktivitet/ActivityRouteCard";
import { ActivityStatsCard } from "@/components/cobalt/aktivitet/ActivityStatsCard";
import { ActivityZoneSplitCard } from "@/components/cobalt/aktivitet/ActivityZoneSplitCard";
import { SectionHeading } from "@/components/cobalt/SectionHeading";
import { auth } from "@/lib/auth";
import {
  type ActivityDetailLike,
  buildActivityDetailView,
  findActivityById,
} from "@/lib/cobalt/aktivitet";
import { getActivityById } from "@/lib/db/queries";
import type { HrZone } from "@/types/domain";

// Aktivitetsdetalje (issue #92) — the page behind every row on /aktiviteter.
// A Server Component following the #84 data rule: a signed-in user gets their
// own row (getActivityById enforces ownership), and everyone else — visitors,
// and signed-in users still browsing the demo fixtures — falls back to
// demoActivities. An id that matches neither is a 404.
//
// force-dynamic: the row is per-session, so nothing here may be prerendered
// across users.
export const dynamic = "force-dynamic";

export default async function AktivitetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const row = userId ? await getActivityById(userId, id) : null;
  // `hr_zones` is a jsonb column, which Drizzle types as `unknown`; the sync
  // writer only ever stores HrZone[] — the same explicit-JSON narrowing as
  // getDashboardActivities.
  const activity: ActivityDetailLike | null = row
    ? { ...row, hrZones: (row.hrZones as HrZone[] | null) ?? null }
    : findActivityById(id);

  if (!activity) notFound();

  const view = buildActivityDetailView(activity);

  return (
    <main>
      <ActivityDetailHeader view={view} />

      <div className="grid grid-cols-12 gap-4 pt-4">
        <div className="col-span-12 lg:col-span-7">
          <SectionHeading index="01" title="Rute" hint="GPS" />
          <ActivityRouteCard
            coords={view.routeCoords}
            km={view.km}
            elevation={view.routeElevation}
            name={view.name}
          />
        </div>

        <div className="col-span-12 lg:col-span-5">
          <SectionHeading
            index="02"
            title="Zone-fordeling"
            hint={view.zoneSplit.estimated ? "Estimeret" : "Målt"}
          />
          <ActivityZoneSplitCard split={view.zoneSplit} />
        </div>

        <div className="col-span-12">
          <SectionHeading index="03" title="Detaljer" hint={view.typeLabel} />
          <ActivityStatsCard stats={view.stats} />
        </div>
      </div>
    </main>
  );
}
