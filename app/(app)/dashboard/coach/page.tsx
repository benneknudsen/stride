import { Suspense } from "react";
import { CoachConsole } from "@/components/cobalt/coach/CoachConsole";
import { CoachFeed } from "@/components/cobalt/coach-dashboard/CoachFeed";
import { LoadGauge } from "@/components/cobalt/coach-dashboard/LoadGauge";
import { PaceEfficiencyChart } from "@/components/cobalt/coach-dashboard/PaceEfficiencyChart";
import { VolumeTrendChart } from "@/components/cobalt/coach-dashboard/VolumeTrendChart";
import { WeekStrip } from "@/components/cobalt/coach-dashboard/WeekStrip";
import { WorkoutCard } from "@/components/cobalt/coach-dashboard/WorkoutCard";
import { ZoneDistributionChart } from "@/components/cobalt/coach-dashboard/ZoneDistributionChart";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { RunnerLoader } from "@/components/cobalt/RunnerLoader";
import { SectionHeading } from "@/components/cobalt/SectionHeading";
import { auth } from "@/lib/auth";
import type { CoachActivityInput } from "@/lib/coach/dashboard";
import { computeCoachDashboard, getProgressionCharts } from "@/lib/coach/dashboard-data";
import type { CoachFeedActivityInput } from "@/lib/coach/feed";
import { buildCoachView, buildLiveCoachView } from "@/lib/cobalt/coach";
import { getDashboardActivities, getRacePlan } from "@/lib/db/queries";
import { demoActivities } from "@/lib/demo/data";

// Coach (issues #34 + #75, consolidated in #86) — the single coach route the
// NavBar and BottomTabBar point at; /coach permanently redirects here
// (next.config.ts). A server component composing four sections, each behind its
// own Suspense boundary so it streams in independently:
//   1. Næste pas   — the recommender's card + week strip, recomputed per request
//   2. AI-coach    — chat + form/readiness + 14-day training load (was /coach)
//   3. Progression — pace/zone/volume/load charts, cached 1 h (getProgressionCharts)
//   4. Coach-feed  — AI coach cards streamed client-side from /api/ai/analyze
//
// Every section reads the signed-in user's own runs (getDashboardActivities,
// the #84 pattern) and falls back to the demo fixtures when nothing is synced.
//
// force-dynamic keeps the workout card real-time; the progression charts stay
// cached across requests via their own unstable_cache tag ("progression").
export const dynamic = "force-dynamic";

/** What every section on this page reads: the engine's input plus the two fields
 *  only the AI feed needs. Demo fixtures and `getDashboardActivities` rows both
 *  fit — the averages are nullable because the DB columns are. */
type CoachPageActivity = CoachActivityInput & {
  averageSpeed: number | null;
  totalElevationGain: number | null;
};

/** The activity subset the client feed needs — mapped server-side so the RSC
 *  payload stays lean and serialization-safe (ISO strings, no Date instances). */
function toFeedActivities(activities: CoachPageActivity[]): CoachFeedActivityInput[] {
  return activities.map((a) => ({
    startDate: a.startDate.toISOString(),
    distance: a.distance,
    movingTime: a.movingTime,
    averageSpeed: a.averageSpeed,
    averageHeartrate: a.averageHeartrate,
    totalElevationGain: a.totalElevationGain,
  }));
}

/** A frosted placeholder holding each section's height while it streams in —
 *  the centred RunnerLoader, per spec (no skeleton loaders). */
function SectionLoader({ height }: { height: number }) {
  return (
    <GlassCard className="flex items-center justify-center" style={{ height }}>
      <RunnerLoader />
    </GlassCard>
  );
}

// ── 1. Næste pas (real-time) ────────────────────────────────────────────────
async function NextWorkoutSection({
  activities,
  raceDate,
}: {
  activities: CoachPageActivity[];
  raceDate?: Date;
}) {
  const { workout, weekStrip } = computeCoachDashboard(activities, raceDate);
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-7">
        <WorkoutCard workout={workout} />
      </div>
      <div className="col-span-12 lg:col-span-5">
        <WeekStrip days={weekStrip} />
      </div>
    </div>
  );
}

// ── 3. Progression (cached 1 h) ─────────────────────────────────────────────
async function ProgressionSection({
  activities,
  raceDate,
  scope,
}: {
  activities: CoachPageActivity[];
  raceDate?: Date;
  scope?: string;
}) {
  const { paceSeries, zoneSeries, volumeSeries, loadGauge } = await getProgressionCharts({
    activities,
    raceDate,
    scope,
  });
  return (
    <div className="grid grid-cols-12 gap-4">
      <ChartCard
        className="col-span-12 lg:col-span-6"
        title="Pace-efficiency"
        hint="Pace/puls pr. uge"
      >
        <PaceEfficiencyChart data={paceSeries} />
      </ChartCard>
      <ChartCard
        className="col-span-12 lg:col-span-6"
        title="Zone-fordeling"
        hint="Rullende 4 uger"
      >
        <ZoneDistributionChart data={zoneSeries} />
      </ChartCard>
      <ChartCard className="col-span-12 sm:col-span-7" title="Volumen" hint="km pr. uge">
        <VolumeTrendChart data={volumeSeries} />
      </ChartCard>
      <ChartCard className="col-span-12 sm:col-span-5" title="Belastning" hint="Akut / kronisk">
        <LoadGauge gauge={loadGauge} />
      </ChartCard>
    </div>
  );
}

function ChartCard({
  className,
  title,
  hint,
  children,
}: {
  className: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className={`${className} p-[20px]`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.16em] text-ink">
          {title}
        </span>
        <span className="font-cg-mono text-[9.5px] uppercase tracking-[0.12em] text-ink/70">
          {hint}
        </span>
      </div>
      {children}
    </GlassCard>
  );
}

export default async function CoachPage() {
  // Issue #86: the coach reads the user's own runs, like every other page since
  // #84. Issue #99: the recommender and the cached charts anchor to the user's
  // own race. Both fall back to the demo fixtures — a signed-in user with
  // nothing synced still sees a working product, and so does a visitor.
  const session = await auth();
  const userId = session?.user?.id;

  const [rows, racePlan] = userId
    ? await Promise.all([getDashboardActivities(userId), getRacePlan(userId)])
    : [[], null];

  const live = rows.length > 0;
  const activities: CoachPageActivity[] = live ? rows : demoActivities;
  const raceDate = racePlan?.raceDate ?? undefined;
  // The progression cache is keyed per user so one runner's charts can never be
  // served to another; everyone on the fixtures shares the "demo" entry.
  const scope = live && userId ? userId : undefined;

  // The console's chat + cards derive from the same dashboard the workout card
  // above them shows, so the two can never contradict each other.
  const coachView = session?.user
    ? buildLiveCoachView(computeCoachDashboard(activities, raceDate), activities)
    : buildCoachView();

  return (
    <main className="flex flex-col gap-8 pt-4 pb-4">
      <header className="flex flex-col gap-1">
        <span className="font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">Træner</span>
        <h1 className="m-0 font-cg-display text-[32px] leading-none text-cobalt">Coach</h1>
        <p className="m-0 text-[13.5px] text-ink">
          Dit næste pas, din progression og din AI-coach — samlet på ét sted.
        </p>
      </header>

      <section>
        <SectionHeading index="01" title="Næste pas" hint="Realtid" />
        <Suspense fallback={<SectionLoader height={280} />}>
          <NextWorkoutSection activities={activities} raceDate={raceDate} />
        </Suspense>
      </section>

      <section>
        <SectionHeading index="02" title="Spørg coachen" hint="AI · samtale" />
        <CoachConsole view={coachView} />
      </section>

      <section>
        <SectionHeading index="03" title="Progression" hint="Cachet 1 t" />
        <Suspense fallback={<SectionLoader height={520} />}>
          <ProgressionSection activities={activities} raceDate={raceDate} scope={scope} />
        </Suspense>
      </section>

      <section>
        <SectionHeading index="04" title="Coach-feed" hint="AI · streamet" />
        <Suspense fallback={<SectionLoader height={240} />}>
          <CoachFeed activities={toFeedActivities(activities)} />
        </Suspense>
      </section>
    </main>
  );
}
