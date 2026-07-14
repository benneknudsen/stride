"use client";

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { cn } from "@/lib/utils";

// The coach's analysis of the demo's "Tempo Tuesday" (lib/demo/data.ts):
// 10,0 km at 4.45 min/km = 4:27/km over 44:30, avg HR 165, max 180 (seed
// index 1), cadence 184 spm — with "Long Run Sunday" (21,1 km) three days
// earlier and "Morning Easy Run" (8,2 km @ 5:21/km, HR 142) the day after,
// so even the advice matches what the demo runner actually did next.
const SCRIPT = `Stærk tempotur. 10,0 km på 44:30 giver en snitpace på 4:27/km ved puls 165 — kontrolleret tærskelarbejde, præcis hvor det skal ligge. Kadencen på 184 spm holdt hele vejen, selv med søndagens 21,1 km i benene, og makspulsen på 180 fortæller, at du havde lidt i reserve.

Planen i morgen: rolig tur på ca. 8 km omkring 5:20/km med puls under 145, så du absorberer belastningen inden næste nøglepas.`;

const START_DELAY_MS = 600;
const TYPE_MS = 26;
const HOLD_MS = 4500;
const RESTART_DELAY_MS = 700;

type Phase = "waiting" | "typing" | "static";

// The landing page's "AI moment": the pre-written analysis above replayed
// character by character, looping forever. No API call — the mono label says
// honestly that it is an example. Hydration-safe because the server renders
// the "waiting" phase (script present but transparent, so the card already
// has its final size) and the animation only starts in useEffect. Visitors
// who prefer reduced motion get the full text statically instead.
export function CoachTeaser() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("static");
      return;
    }
    setPhase("typing");
    let position = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (position < SCRIPT.length) {
        position += 1;
        setTyped(position);
        timer = setTimeout(tick, TYPE_MS);
      } else {
        // Hold the finished analysis on screen, then wipe and replay.
        timer = setTimeout(() => {
          position = 0;
          setTyped(0);
          timer = setTimeout(tick, RESTART_DELAY_MS);
        }, HOLD_MS);
      }
    };
    timer = setTimeout(tick, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <GlassCard className="rounded-widget p-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span className="flex items-center gap-2 font-cg-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cobalt">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-red [animation:cg-pulse-dot_1.4s_ease-in-out_infinite] motion-reduce:[animation:none]"
          />
          AI-coachen · Eksempel på analyse
        </span>
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
          Tempo Tuesday · 10,0 km · 4:27 /km
        </span>
      </div>

      <div className="relative mt-5">
        {/* The full script stays in the tree in every phase: it sizes the card
            so the typewriter never reflows the page, and it is what screen
            readers get — the animated overlay below is aria-hidden. */}
        <p
          className={cn(
            "m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-cobalt",
            phase !== "static" && "opacity-0"
          )}
        >
          {SCRIPT}
        </p>
        {phase === "typing" ? (
          <p
            aria-hidden="true"
            className="absolute inset-0 m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-cobalt"
          >
            {SCRIPT.slice(0, typed)}
            <span
              data-testid="coach-cursor"
              className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-[1px] bg-red [animation:cg-pulse-dot_1s_ease-in-out_infinite]"
            />
          </p>
        ) : null}
      </div>
    </GlassCard>
  );
}
