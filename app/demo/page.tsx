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
import { RunnerLoader } from "@/components/cobalt/RunnerLoader";
import { buildHomeView, greetingForHour, type HomeView } from "@/lib/cobalt/hjem";

function Bento({ span, delay, children }: { span: string; delay: number; children: ReactNode }) {
  return (
    <div
      className={`${span} [animation:cg-fade-up_0.6s_ease_both] motion-reduce:[animation:none]`}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

export default function DemoPage() {
  const [view, setView] = useState<HomeView | null>(null);
  const [greeting, setGreeting] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const now = new Date();
    try {
      const v = buildHomeView(now);
      setView(v);
      setGreeting(greetingForHour(now.getHours()));
    } catch (e) {
      console.error("buildHomeView failed", e);
    }
    setTimeout(() => setReady(true), 2000);
  }, []);

  if (!view) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-silver">
        <RunnerLoader size={70} label="HENTER DEMO DATA…" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-silver font-cg-sans">
      <div className="relative mx-auto max-w-[1360px] px-4 pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)_+_96px)] md:px-7 md:pt-0 md:pb-10">
        <div className="mb-6 flex items-center justify-between rounded-card border border-cobalt/10 bg-white/60 px-5 py-3 shadow-glass backdrop-blur-xl">
          <span className="text-[13px] text-ink/70">
            🏃 <strong className="text-cobalt">Demo-tilstand</strong> — data er fiktiv.
          </span>
          <a
            href="/login"
            className="rounded-card bg-cobalt px-4 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Log ind
          </a>
        </div>

        <Hero
          weekNumber={view.weekNumber}
          weeklyKm={view.weeklyKm}
          greeting={greeting}
          started={ready}
        />

        <div className="relative pt-4">
          <div className="grid grid-cols-12 gap-4">
            <Bento span="col-span-12" delay={0.05}>
              <PlanStrip {...view.plan} started={ready} />
            </Bento>
            <Bento span="col-span-12 lg:col-span-6" delay={0.12}>
              <LatestActivityCard latest={view.latest} started={ready} />
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
                started={ready}
              />
            </Bento>
            <Bento span="col-span-12 sm:col-span-4" delay={0.3}>
              <VolumeCard bars={view.volumeBars} started={ready} />
            </Bento>
            <Bento span="col-span-12 sm:col-span-3" delay={0.36}>
              <RecoveryCard pct={view.recoveryPct} note={view.recoveryNote} started={ready} />
            </Bento>
            <Bento span="col-span-12 sm:col-span-5" delay={0.42}>
              <AiCoachCard quote={view.coachQuote} />
            </Bento>
            <Bento span="col-span-12 lg:col-span-7" delay={0.48}>
              <RecentRunsCard runs={view.recentRuns} />
            </Bento>
            <Bento span="col-span-12 lg:col-span-5" delay={0.54}>
              <DataSourcesCard />
            </Bento>
          </div>
        </div>
      </div>
    </main>
  );
}
