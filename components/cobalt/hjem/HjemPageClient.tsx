"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { AiCoachCard } from "@/components/cobalt/hjem/AiCoachCard";
import { DataSourcesCard } from "@/components/cobalt/hjem/DataSourcesCard";
import { Hero } from "@/components/cobalt/hjem/Hero";
import { LatestActivityCard } from "@/components/cobalt/hjem/LatestActivityCard";
import { PaceTrendCard } from "@/components/cobalt/hjem/PaceTrendCard";
import { PlanStrip } from "@/components/cobalt/hjem/PlanStrip";
import { RecentRunsCard } from "@/components/cobalt/hjem/RecentRunsCard";
import { RecoveryCard } from "@/components/cobalt/hjem/RecoveryCard";
import { RouteCard } from "@/components/cobalt/hjem/RouteCard";
import { VolumeCard } from "@/components/cobalt/hjem/VolumeCard";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { useStartupReveal } from "@/hooks/useStartupReveal";
import { greetingForHour, type HomeView } from "@/lib/cobalt/hjem";
import { ROUTES } from "@/lib/routes";

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
  isDemo = false,
}: {
  view: HomeView;
  userName?: string;
  stravaConnected: boolean;
  garminConnected: boolean;
  signedIn: boolean;
  /** True only for a visitor on `?demo=1` (#124) — never for a signed-in user. */
  isDemo?: boolean;
}) {
  const { loading, started } = useStartupReveal();
  // The greeting follows the visitor's clock, but `new Date()` during SSR reads
  // the server's clock (Vercel = UTC), so seeding it here would let server and
  // client render different branches of greetingForHour → hydration mismatch and
  // a wrong first paint. Instead render a neutral placeholder ("Goddag") that's
  // identical on both sides, then swap in the real, local-clock greeting in an
  // effect after mount (#134). The placeholder shares the greeting's length range,
  // so the swap doesn't shift layout.
  const [greeting, setGreeting] = useState("Goddag");

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  return (
    <main>
      {/* Demo-markering (#124): a sticky glass bar so a visitor browsing the
          demo dashboard always knows the numbers are fixtures — with the way
          into the real thing one click away. Sticky (not fixed) so it scrolls
          inside the page flow and can't detach on iOS like a fixed bar with
          backdrop-filter would; z-40 keeps it under the BottomTabBar (z-50). */}
      {isDemo ? (
        <div className="sticky top-2 z-40 mt-3 flex justify-center sm:mt-4 [animation:cg-fade-up_0.6s_ease_both] motion-reduce:[animation:none]">
          {/* A centered, content-wide pill — not a second full-width bar, which
              stacked heavily right under the NavBar. One line always: the text
              truncates and the login pill never wraps under it. */}
          <GlassCard className="flex max-w-full items-center gap-3 rounded-pill py-1.5 pr-1.5 pl-4 sm:gap-4 sm:py-2 sm:pr-2">
            <span className="flex-none rounded-pill bg-red px-2.5 py-1 font-cg-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
              Demo
            </span>
            <p className="m-0 min-w-0 truncate text-[13px] leading-snug text-ink">
              <span className="sm:hidden">Du kigger på eksempeldata</span>
              <span className="hidden sm:inline">Dette er en demo med eksempeldata</span>
            </p>
            <Link
              href={ROUTES.LOGIN}
              className="cg-interactive flex-none rounded-pill bg-cobalt px-4 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 sm:px-5 sm:py-2 sm:text-[13px]"
            >
              Log ind
            </Link>
          </GlassCard>
        </div>
      ) : null}

      <Hero
        weekNumber={view.weekNumber}
        weeklyKm={view.weeklyKm}
        greeting={greeting}
        note={view.heroNote}
        userName={userName}
        planName={view.plan.raceName}
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
              name={view.latest.name}
            />
          </Bento>
          <Bento span="col-span-12 sm:col-span-6 lg:col-span-3" delay={0.24}>
            <PaceTrendCard
              paceLabel={view.avgPaceLabel}
              points={view.paceTrend}
              deltaLabel={view.avgPaceDeltaLabel}
              started={started}
            />
          </Bento>

          <Bento span="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.3}>
            <VolumeCard bars={view.volumeBars} started={started} />
          </Bento>
          <Bento span="col-span-12 sm:col-span-6 lg:col-span-3" delay={0.36}>
            <RecoveryCard pct={view.readinessPct} note={view.readinessNote} started={started} />
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
