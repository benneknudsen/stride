import Link from "next/link";
import type { ReactNode } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { Logo } from "@/components/cobalt/Logo";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { SectionHeading } from "@/components/cobalt/SectionHeading";
import { CoachTeaser } from "@/components/cobalt/velkommen/CoachTeaser";
import { PreviewShowcase } from "@/components/cobalt/velkommen/PreviewShowcase";
import { Wordmark } from "@/components/cobalt/Wordmark";
import { buildHomeView } from "@/lib/cobalt/hjem";
import { DEMO_HOME_ROUTE, ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Velkommen — the landing page a visitor without a session meets on "/". It
// pitches the product and hands over to the demo (DEMO_HOME_ROUTE) or login;
// signed-in users never see it (app/(app)/page.tsx routes them straight to
// their dashboard). A Server Component end to end: the entrance animations are
// plain CSS (cg-fade-up), and the only client island is the PreviewShowcase,
// which needs a mounted flag to run the widgets' count-up choreography.
export function VelkommenPage() {
  // The preview runs on the same demo view-model as the demo dashboard itself
  // (all-default arguments = the 30 fixtures), so the numbers a visitor sees
  // here are the numbers the demo greets them with one click later.
  const view = buildHomeView();

  return (
    <main className="pb-8">
      {/* ── Landing header — the app chrome (NavBar/BottomTabBar) is gated off
             on this page (LandingChromeGate), so the landing brings its own
             minimal top bar: brand on the left, login on the right. ── */}
      <header className="mt-[18px] flex items-center justify-between">
        <span className="flex items-center gap-3">
          <Logo />
          <Wordmark />
        </span>
        <Link
          href={ROUTES.LOGIN}
          className="cg-interactive cg-glass rounded-pill px-5 py-2 text-[13px] font-semibold text-cobalt transition-colors hover:text-red"
        >
          Log ind
        </Link>
      </header>

      {/* ── Hero ── */}
      <section className="px-3 pt-14 pb-12 text-center md:pt-20 md:pb-16">
        <Reveal delay={0}>
          <div className="mb-4 font-cg-mono text-[11px] uppercase tracking-[0.22em] text-red">
            AI-drevet løbetræning
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 className="mx-auto m-0 max-w-[820px] font-cg-serif text-[44px] italic leading-[1.04] tracking-[-0.015em] text-cobalt sm:text-[60px] md:text-[68px]">
            Al din løbedata.
            <br />
            Én coach, der forstår den.
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mx-auto mt-6 max-w-[560px] text-[15.5px] leading-relaxed text-ink">
            Stride samler dine ture fra Strava og Garmin, analyserer hver eneste af dem med AI og
            bygger en ugeplan, der peger mod dit næste race.
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={DEMO_HOME_ROUTE}
              className="cg-interactive rounded-pill bg-cobalt px-7 py-3 text-[14px] font-semibold text-white shadow-[0_12px_36px_rgba(27,41,192,0.35)] transition-opacity hover:opacity-90"
            >
              Udforsk demoen
            </Link>
            <Link
              href={ROUTES.LOGIN}
              className="cg-interactive cg-glass rounded-pill px-7 py-3 text-[14px] font-semibold text-cobalt transition-colors hover:text-red"
            >
              Log ind
            </Link>
          </div>
        </Reveal>
        <Reveal delay={0.32}>
          <p className="mt-5 font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink/70">
            Demoen kræver ingen konto · 30 løbeture venter
          </p>
        </Reveal>
      </section>

      {/* ── Live forsmag: the real widgets on the real demo data ── */}
      <Reveal delay={0.4} as="section" ariaLabel="Forsmag på dashboardet">
        <SectionHeading index="01" title="Forsmag" hint="Direkte fra dashboardet" />
        <PreviewShowcase
          weeklyKm={view.weeklyKm}
          routeCoords={view.routeCoords}
          routeKm={view.routeKm}
          routeElevation={view.routeElevation}
          routeName={view.latest.name}
          avgPaceLabel={view.avgPaceLabel}
          avgPaceFraction={view.avgPaceFraction}
          avgPaceDeltaLabel={view.avgPaceDeltaLabel}
          volumeBars={view.volumeBars}
        />
      </Reveal>

      {/* ── Features ── */}
      <section className="mt-16" aria-label="Funktioner">
        <SectionHeading index="02" title="Hvad Stride kan" hint="AI hele vejen rundt" />
        <div className="grid grid-cols-12 gap-4">
          <FeatureCard
            delay={0.05}
            icon={<SparkIcon />}
            title="AI-analyse af hver tur"
            body="Hver aktivitet får sin egen gennemgang — pacing, pulszoner, effort og konkrete råd, streamet live mens du kigger."
          />
          <FeatureCard
            delay={0.12}
            icon={<ChatIcon />}
            title="En coach, du kan spørge"
            body="Chatcoachen slår op i dine egne tal. Spørg til din uge, dit race eller din restitution — svaret bygger på dine ture, ikke på gæt."
          />
          <FeatureCard
            delay={0.19}
            icon={<FlagIcon />}
            title="Race-prediktor & ugeplan"
            body="Riegel-prediktion med HR-loft fra hele din historik og en fasedelt ugeplan, der bygger mod racedagen — uge for uge."
          />

          <Reveal delay={0.26} className="col-span-12">
            <GlassCard className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-widget px-[26px] py-[18px]">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 font-cg-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cobalt">
                  <span className="size-2 rounded-full bg-strava" aria-hidden="true" />
                  Strava
                </span>
                <span className="flex items-center gap-2 font-cg-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cobalt">
                  <span className="size-2 rounded-full bg-garmin" aria-hidden="true" />
                  Garmin
                </span>
              </div>
              <p className="m-0 text-[13.5px] leading-relaxed text-ink">
                Forbind én gang — webhooks holder dine ture opdaterede, og dine tokens ligger
                krypteret på serveren.
              </p>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* ── Sådan kommer du i gang ── */}
      <section className="mt-16" aria-label="Sådan kommer du i gang">
        <SectionHeading index="03" title="Sådan kommer du i gang" hint="Tre skridt" />
        <div className="grid grid-cols-12 gap-4">
          <StepCard
            delay={0.05}
            step="01"
            title="Forbind din data"
            body="Log ind og forbind Strava eller Garmin — dine seneste ture lander i dashboardet med det samme."
          />
          <StepCard
            delay={0.12}
            step="02"
            title="Få analysen"
            body="AI'en gennemgår hver tur og samler ugen: volumen, snit-pace, restitution og zoner."
          />
          <StepCard
            delay={0.19}
            step="03"
            title="Følg planen"
            body="Race-prediktoren sætter målet; ugeplanen viser vejen derhen, fase for fase."
          />
        </div>
      </section>

      {/* ── AI-øjeblik: coachens analyse som typewriter-replay ── */}
      <Reveal delay={0.05} as="section" ariaLabel="Eksempel på coachens analyse" className="mt-16">
        <SectionHeading index="04" title="Coachen i aktion" hint="Replay på demoens data" />
        <CoachTeaser />
      </Reveal>

      {/* ── Afsluttende CTA ── */}
      <section className="mt-16">
        <GlassCard
          variant="cobalt"
          className="relative overflow-hidden rounded-widget px-8 py-12 text-center md:py-16"
        >
          <RunnerGlyph size={40} className="mx-auto mb-5" />
          <h2 className="m-0 font-cg-serif text-[34px] italic leading-[1.05] tracking-[-0.01em] text-silver md:text-[46px]">
            Klar til din næste PR?
          </h2>
          <p className="mx-auto mt-4 max-w-[440px] text-[14.5px] leading-relaxed text-silver/80">
            Log ind med Google eller Garmin — eller kig dig omkring i demoen først.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={ROUTES.LOGIN}
              className="cg-interactive rounded-pill bg-silver px-7 py-3 text-[14px] font-semibold text-cobalt transition-opacity hover:opacity-90"
            >
              Kom i gang
            </Link>
            <Link
              href={DEMO_HOME_ROUTE}
              className="cg-interactive rounded-pill border border-silver/40 px-7 py-3 text-[14px] font-semibold text-silver transition-colors hover:border-silver"
            >
              Udforsk demoen
            </Link>
          </div>
        </GlassCard>
        <p className="mt-8 text-center font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink/60">
          Bygget med Next.js · TypeScript · Drizzle · Vercel AI SDK
        </p>
      </section>
    </main>
  );
}

// Staggered entrance shared by every hero element — same cg-fade-up curve the
// dashboard's bento uses, so landing and app move as one system.
function Reveal({
  delay,
  children,
  as = "div",
  ariaLabel,
  className,
}: {
  delay: number;
  children: ReactNode;
  as?: "div" | "section";
  ariaLabel?: string;
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag
      aria-label={ariaLabel}
      className={cn(
        "[animation:cg-fade-up_0.7s_ease_both] motion-reduce:[animation:none]",
        className
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </Tag>
  );
}

function FeatureCard({
  delay,
  icon,
  title,
  body,
}: {
  delay: number;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Reveal delay={delay} className="col-span-12 h-full md:col-span-4 [&>*]:h-full">
      <GlassCard className="flex flex-col rounded-widget p-[26px]">
        <span className="flex size-10 items-center justify-center rounded-tile bg-cobalt/[0.07]">
          {icon}
        </span>
        <h3 className="mt-5 mb-0 font-cg-display text-[18px] font-bold tracking-[-0.02em] text-cobalt">
          {title}
        </h3>
        <p className="mt-2 mb-0 text-[13.5px] leading-relaxed text-ink">{body}</p>
      </GlassCard>
    </Reveal>
  );
}

function StepCard({
  delay,
  step,
  title,
  body,
}: {
  delay: number;
  step: string;
  title: string;
  body: string;
}) {
  return (
    <Reveal delay={delay} className="col-span-12 h-full md:col-span-4 [&>*]:h-full">
      <GlassCard className="flex flex-col rounded-widget p-[26px]">
        <span className="font-cg-mono text-[26px] font-semibold leading-none text-red">{step}</span>
        <h3 className="mt-4 mb-0 font-cg-display text-[16px] font-bold tracking-[-0.02em] text-cobalt">
          {title}
        </h3>
        <p className="mt-2 mb-0 text-[13.5px] leading-relaxed text-ink">{body}</p>
      </GlassCard>
    </Reveal>
  );
}

// Icon trio for the feature cards — drawn in the BottomTabBar's stroke style so
// the landing page reads as the same hand.
function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
        fill="var(--color-red)"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.5 C4 5.1 5.1 4 6.5 4 H17.5 C18.9 4 20 5.1 20 6.5 V13.5 C20 14.9 18.9 16 17.5 16 H9 L5 20 V16 H6.5 C5.1 16 4 14.9 4 13.5 Z"
        stroke="var(--color-cobalt)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="10" r="1.2" fill="var(--color-red)" />
      <circle cx="13" cy="10" r="1.2" fill="var(--color-cobalt)" />
      <circle cx="17" cy="10" r="1.2" fill="var(--color-cobalt)" opacity="0.45" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 21 V4" stroke="var(--color-cobalt)" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M6 5 H17 L14.5 8.5 L17 12 H6"
        stroke="var(--color-red)"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
