"use client";

import type { ReactNode } from "react";
import { FormStatusCard } from "@/components/cobalt/coach/FormStatusCard";
import { TrainingLoadCard } from "@/components/cobalt/coach/TrainingLoadCard";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { useStartupReveal } from "@/hooks/useStartupReveal";
import type { CoachView } from "@/lib/cobalt/coach";

// Widget wrapper applying the staggered fadeUp entrance to a panel.
function Panel({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <div
      className="[animation:cg-fade-up_0.6s_ease-both] motion-reduce:[animation:none]"
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

// The coach console: form/readiness and 14-day training load side by side.
// Since issue #86 it is one section of the consolidated coach route, so the page
// owns the heading and the recommended workout. Both cards are pure derivations
// of the athlete's own activities — there is nothing to ask the coach.
//
// Owns the client-only loading choreography the server page can't: one overlay
// covers the area for a beat, and when it lifts the form bar and the 14-day load
// bars animate in. The view itself is built server-side (demo or live) and
// arrives as a plain-JSON prop.
export function CoachConsole({ view }: { view: CoachView }) {
  const { loading, started } = useStartupReveal();

  return (
    <div className="relative">
      <div className="grid grid-cols-12 items-start gap-4">
        <div className="col-span-12 md:col-span-6">
          <Panel delay={0.08}>
            <FormStatusCard form={view.form} started={started} />
          </Panel>
        </div>

        <div className="col-span-12 md:col-span-6">
          <Panel delay={0.14}>
            <TrainingLoadCard load={view.load} started={started} />
          </Panel>
        </div>
      </div>

      <LoadingOverlay show={loading} label="ANALYSERER DIN TRÆNING…" />
    </div>
  );
}
