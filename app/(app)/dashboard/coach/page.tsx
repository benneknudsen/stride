import { Suspense } from "react";
import { CoachFeed } from "@/components/cobalt/coach-dashboard/CoachFeed";
import { LoadGauge } from "@/components/cobalt/coach-dashboard/LoadGauge";
import { PaceEfficiencyChart } from "@/components/cobalt/coach-dashboard/PaceEfficiencyChart";
import { VolumeTrendChart } from "@/components/cobalt/coach-dashboard/VolumeTrendChart";
import { WeekStrip } from "@/components/cobalt/coach-dashboard/WeekStrip";
import { WorkoutCard } from "@/components/cobalt/coach-dashboard/WorkoutCard";
import { ZoneDistributionChart } from "@/components/cobalt/coach-dashboard/ZoneDistributionChart";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { computeCoachDashboard, getProgressionCharts } from "@/lib/coach/dashboard-data";
import type { CoachFeedActivityInput } from "@/lib/coach/feed";
import { demoActivities } from "@/lib/demo/data";

// Coach dashboard (issue #34) — the unified trainer view at /dashboard/coach.
// A server component composing three sections, each behind its own Suspense
// boundary so it streams in independently:
//   1. Næste pas   — the recommender's card + week strip, recomputed per request
//   2. Progression — pace/zone/volume/load charts, cached 1 h (getProgressionCharts)
//   3. Coach-feed  — AI coach cards streamed client-side from /api/ai/analyze
//
// force-dynamic keeps the workout card real-time; the progression charts stay
// cached across requests via their own unstable_cache tag ("progression").
export const dynamic = "force-dynamic";

/** The activity subset the client feed needs — mapped server-side so the RSC
 *  payload stays lean and serialization-safe (ISO strings, no Date instances). */
const feedActivities: CoachFeedActivityInput[] = demoActivities.map((a) => ({
  startDate: a.startDate.toISOString(),
  distance: a.distance,
  movingTime: a.movingTime,
  averageSpeed: a.averageSpeed,
  averageHeartrate: a.averageHeartrate,
  totalElevationGain: a.totalElevationGain,
}));

function SectionHeading({ index, title, hint }: { index: string; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="font-cg-mono text-[11px] text-red">{index}</span>
      <h2 className="m-0 font-cg-display text-[20px] leading-none text-cobalt">{title}</h2>
      <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">{hint}</span>
    </div>
  );
}

/** A frosted placeholder that holds each section's height while it streams in. */
function SectionSkeleton({ height }: { height: number }) {
  return <GlassCard className="animate-pulse" style={{ height }} aria-hidden="true" />;
}

// ── 1. Næste pas (real-time) ────────────────────────────────────────────────
async function NextWorkoutSection() {
  const { workout, weekStrip } = computeCoachDashboard();
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

// ── 2. Progression (cached 1 h) ─────────────────────────────────────────────
async function ProgressionSection() {
  const { paceSeries, zoneSeries, volumeSeries, loadGauge } = await getProgressionCharts();
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

export default function CoachDashboardPage() {
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
        <Suspense fallback={<SectionSkeleton height={280} />}>
          <NextWorkoutSection />
        </Suspense>
      </section>

      <section>
        <SectionHeading index="02" title="Progression" hint="Cachet 1 t" />
        <Suspense fallback={<SectionSkeleton height={520} />}>
          <ProgressionSection />
        </Suspense>
      </section>

      <section>
        <SectionHeading index="03" title="Coach-feed" hint="AI · streamet" />
        <Suspense fallback={<SectionSkeleton height={240} />}>
          <CoachFeed activities={feedActivities} />
        </Suspense>
      </section>
    </main>
  );
}
