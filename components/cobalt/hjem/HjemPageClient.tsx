"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AiCoachCard } from "@/components/cobalt/hjem/AiCoachCard";
import { AvgPaceRing } from "@/components/cobalt/hjem/AvgPaceRing";
import { DataSourcesCard } from "@/components/cobalt/hjem/DataSourcesCard";
import { Hero } from "@/components/cobalt/hjem/Hero";
import { LatestActivityCard } from "@/components/cobalt/hjem/LatestActivityCard";
import { PlanStrip } from "@/components/cobalt/hjem/PlanStrip";
import { RecentRunsCard } from "@/components/cobalt/hjem/RecentRunsCard";
import { RecoveryCard } from "@/components/cobalt/hjem/RecoveryCard";
import { RouteCard } from "@/components/cobalt/hjem/RouteCard";
import { VolumeCard } from "@/components/cobalt/hjem/VolumeCard";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { greetingForHour, type HomeView } from "@/lib/cobalt/hjem";

// Widget wrapper applying the staggered fadeUp entrance. `span` is the 12-col
// grid span; `delay` staggers each widget's reveal. The wrapper stretches to its
// grid cell for free, but the card inside it doesn't — `[&>*]:h-full` pushes that
// height down to the GlassCard so short widgets fill the row set by the tallest
// one instead of leaving a hole under themselves (#97).
function Bento({ span, delay, children }: { span: string; delay: number; children: ReactNode }) {
  return (
    <div
      className={`${span} h-full [&>*]:h-full [animation:cg-fade-up_0.6s_ease_both] motion-reduce:[animation:none]`}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

// Hjem (Dashboard) — the Cobalt Glass bento. Owns the client-only loading
// choreography the server page can't: hero + nav stay visible (the hero km
// pulses at "0,0") while one overlay covers the widget grid for a beat; when
// it lifts, the km counts up and every widget animation runs. The view itself
// is built server-side (demo or live) and arrives as a plain-JSON prop; the
// greeting stays client-side so it follows the visitor's clock, not the
// server's.
export function HjemPageClient({
  view,
  userName,
  stravaConnected,
  garminConnected,
  signedIn,
}: {
  view: HomeView;
  userName?: string;
  stravaConnected: boolean;
  garminConnected: boolean;
  signedIn: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [greeting] = useState(() => greetingForHour(new Date().getHours()));

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const started = !loading;

  return (
    <main>
      <Hero
        weekNumber={view.weekNumber}
        weeklyKm={view.weeklyKm}
        greeting={greeting}
        note={view.heroNote}
        userName={userName}
        started={started}
      />

      {/* Widget grid: covered by one loading overlay; nav + hero stay visible. */}
      <div className="relative pt-4">
        <div className="grid grid-cols-12 gap-4">
          <Bento span="col-span-12" delay={0.05}>
            <PlanStrip {...view.plan} started={started} />
          </Bento>

          <Bento span="col-span-12 lg:col-span-6" delay={0.12}>
            <LatestActivityCard latest={view.latest} started={started} />
          </Bento>
          <Bento span="col-span-12 sm:col-span-6 lg:col-span-3" delay={0.18}>
            <RouteCard
              coords={view.routeCoords}
              km={view.routeKm}
              elevation={view.routeElevation}
            />
          </Bento>
          <Bento span="col-span-12 sm:col-span-6 lg:col-span-3" delay={0.24}>
            <AvgPaceRing
              paceLabel={view.avgPaceLabel}
              fraction={view.avgPaceFraction}
              deltaLabel={view.avgPaceDeltaLabel}
              started={started}
            />
          </Bento>

          <Bento span="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.3}>
            <VolumeCard bars={view.volumeBars} started={started} />
          </Bento>
          <Bento span="col-span-12 sm:col-span-6 lg:col-span-3" delay={0.36}>
            <RecoveryCard pct={view.recoveryPct} note={view.recoveryNote} started={started} />
          </Bento>
          <Bento span="col-span-12 lg:col-span-5" delay={0.42}>
            <AiCoachCard quote={view.coachQuote} />
          </Bento>

          {view.recentRuns.length > 0 ? (
            <Bento span="col-span-12 lg:col-span-7" delay={0.48}>
              <RecentRunsCard runs={view.recentRuns} />
            </Bento>
          ) : null}
          <Bento span="col-span-12 lg:col-span-5" delay={0.54}>
            <DataSourcesCard
              stravaConnected={stravaConnected}
              garminConnected={garminConnected}
              signedIn={signedIn}
            />
          </Bento>
        </div>

        <LoadingOverlay show={loading} label="HENTER DINE DATA…" />
      </div>
    </main>
  );
}
