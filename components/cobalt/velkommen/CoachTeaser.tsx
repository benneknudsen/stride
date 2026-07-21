"use client";

import { useEffect, useRef, useState } from "react";
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

type Phase = "waiting" | "typing" | "static";

// The landing page's "AI moment": the pre-written analysis above typed out
// character by character, once. No API call — the mono label says honestly
// that it is an example. Hydration-safe because the server renders the
// "waiting" phase (script present but transparent, so the card already has
// its final size) and the animation only starts in useEffect.
//
// The typewriter is gated on an IntersectionObserver (#162): it does not
// start until the card scrolls into view, pauses (stops ticking, burns no
// CPU) whenever it scrolls back off-screen, and freezes on the finished
// analysis after a single playthrough instead of looping forever. Visitors
// who prefer reduced motion get the full text statically instead.
export function CoachTeaser() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [typed, setTyped] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("static");
      return;
    }

    let position = 0;
    let visible = false;
    let started = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (finished || !visible) return;
      if (position < SCRIPT.length) {
        position += 1;
        setTyped(position);
        timer = setTimeout(tick, TYPE_MS);
      } else {
        // One full playthrough is enough — freeze on the finished analysis
        // and stop observing so the card is inert from here on.
        finished = true;
        setPhase("static");
        observer.disconnect();
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry || finished) return;
        visible = entry.isIntersecting;
        if (visible) {
          setPhase("typing");
          // Wait the intro beat on first reveal; resume immediately when
          // the card scrolls back into view mid-animation.
          clearTimeout(timer);
          timer = setTimeout(tick, started ? TYPE_MS : START_DELAY_MS);
          started = true;
        } else {
          // Off-screen: stop ticking until it comes back.
          clearTimeout(timer);
        }
      },
      { threshold: 0 }
    );
    observer.observe(card);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <GlassCard ref={cardRef} className="rounded-widget p-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span className="flex items-center gap-2 cg-label text-[11px] font-semibold text-cobalt">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-red [animation:cg-pulse-dot_1.4s_ease-in-out_infinite] motion-reduce:[animation:none]"
          />
          AI-coachen · Eksempel på analyse
        </span>
        <span className="cg-label">Tempo Tuesday · 10,0 km · 4:27 /km</span>
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
