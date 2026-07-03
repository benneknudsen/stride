"use client";

import { useState } from "react";
import { CountUpNumber } from "@/components/cobalt/CountUpNumber";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { IntensityMeter } from "@/components/cobalt/IntensityMeter";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { RunnerLoader } from "@/components/cobalt/RunnerLoader";
import { SourceBadge } from "@/components/cobalt/SourceBadge";
import { SyncButton } from "@/components/cobalt/SyncButton";

// Showcase for the Cobalt Glass foundation + shared components (Fase 1+2).
export default function TestCobaltPage() {
  const [countRun, setCountRun] = useState(true);
  const [overlay, setOverlay] = useState(false);

  const showOverlay = () => {
    setOverlay(true);
    setTimeout(() => setOverlay(false), 2000);
  };

  return (
    <main className="pt-[38px]">
      {/* Hero */}
      <header className="flex flex-wrap items-end justify-between gap-8 px-3 pb-2">
        <div>
          <div className="mb-3 font-cg-mono text-[11px] uppercase tracking-[0.2em] text-red">
            Cobalt Glass · komponent-galleri
          </div>
          <h1 className="m-0 font-cg-serif text-[54px] italic leading-[1.02] tracking-[-0.015em] text-cobalt">
            Delte komponenter,
            <br />
            ét sted.
          </h1>
        </div>
        <CountUpNumber
          value={23.2}
          label="km denne uge · demo"
          run={countRun}
          className="items-end text-right text-[80px] text-cobalt"
        />
      </header>

      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={() => setCountRun((prev) => !prev)}
          className="rounded-pill border border-cobalt/30 px-[16px] py-[7px] font-cg-mono text-[11px] uppercase tracking-[0.14em] text-cobalt transition-colors hover:bg-cobalt/8"
        >
          {countRun ? "Vis dæmpet 0-state" : "Kør count-up igen"}
        </button>
      </div>

      {/* Bento */}
      <div className="grid grid-cols-12 gap-4 pt-4">
        {/* Alle fire påkrævede komponenter i ét GlassCard */}
        <GlassCard className="col-span-12 flex flex-col gap-5 p-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-ink">
              Fire komponenter · ét kort
            </span>
            <SourceBadge source="garmin" />
          </div>

          <div className="flex items-center gap-4">
            <IntensityMeter level={4} label="Intensitet: Hårdt tempo" />
            <div className="flex-1">
              <div className="font-cg-display text-[24px] font-bold tracking-[-0.03em] text-cobalt">
                IntensityMeter · niveau 4
              </div>
              <div className="text-[12px] text-ink">
                Søjler 1–2 kobolt · 3–5 rød · inaktive 15 %
              </div>
            </div>
            <SourceBadge source="strava" />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-6">
            <CountUpNumber
              value={319.8}
              label="km · count-up"
              run={countRun}
              className="text-[46px] text-cobalt"
            />
            <RunnerLoader size={54} label="RunnerLoader" />
          </div>
        </GlassCard>

        {/* GlassCard variant: red (Restitution) */}
        <GlassCard
          variant="red"
          className="col-span-12 flex flex-col justify-between gap-3 p-[22px] sm:col-span-6 lg:col-span-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] opacity-85">
              Restitution
            </span>
            <span className="size-2 animate-[cg-pulse-dot_1.8s_ease-in-out_infinite] rounded-full bg-onred motion-reduce:animate-none" />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-cg-display text-[46px] font-extrabold leading-none tracking-[-0.03em]">
              86<span className="text-[22px]">%</span>
            </span>
            <span className="text-[12.5px] opacity-90">Klar til hårdt pas</span>
          </div>
          <div
            className="h-[7px] overflow-hidden rounded-pill"
            style={{ background: "rgba(253, 243, 238, 0.3)" }}
          >
            <div className="h-full rounded-pill bg-onred" style={{ width: "86%" }} />
          </div>
        </GlassCard>

        {/* GlassCard variant: cobalt (AI Coach) */}
        <GlassCard
          variant="cobalt"
          className="col-span-12 flex flex-col justify-between gap-4 p-[22px] sm:col-span-6 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <RunnerGlyph size={20} stroke="var(--color-silver)" />
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em]">AI Coach</span>
          </div>
          <p className="font-cg-serif text-[18px] italic leading-[1.3]">
            »Din tempo-tolerance stiger.«
          </p>
        </GlassCard>

        {/* LoadingOverlay + SyncButton states */}
        <GlassCard className="relative col-span-12 flex min-h-[200px] flex-col gap-4 p-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <span className="font-cg-serif text-[22px] italic text-cobalt">
              LoadingOverlay &amp; SyncButton
            </span>
            <button
              type="button"
              onClick={showOverlay}
              className="rounded-pill border border-cobalt/30 px-[18px] py-[9px] text-[12.5px] font-semibold text-cobalt transition-colors hover:bg-cobalt/8"
            >
              Vis overlay (2s) →
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SyncButton state="idle" />
            <SyncButton state="syncing" />
            <SyncButton state="synced" />
          </div>
          <p className="max-w-[46ch] text-[13px] text-ink">
            Overlayet blurrer kun kortet. Ingen skeletons — kun RunnerLoaderen.
          </p>
          <LoadingOverlay show={overlay} />
        </GlassCard>

        {/* Intensity scale reference */}
        <GlassCard className="col-span-12 flex flex-col gap-4 p-6 lg:col-span-5">
          <span className="font-cg-serif text-[22px] italic text-cobalt">Intensitets-skala</span>
          <div className="flex items-end justify-between gap-2">
            {[1, 2, 3, 4, 5].map((level) => (
              <div key={level} className="flex flex-col items-center gap-2">
                <IntensityMeter level={level} label={`Niveau ${level}`} />
                <span className="font-cg-mono text-[10px] tracking-[0.14em] text-ink">{level}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </main>
  );
}
