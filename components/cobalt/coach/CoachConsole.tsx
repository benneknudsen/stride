"use client";

import type { ReactNode } from "react";
import { ChatPanel } from "@/components/cobalt/coach/ChatPanel";
import { FormStatusCard } from "@/components/cobalt/coach/FormStatusCard";
import { TrainingLoadCard } from "@/components/cobalt/coach/TrainingLoadCard";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { useStartupReveal } from "@/hooks/useStartupReveal";
import type { CoachView } from "@/lib/cobalt/coach";

// Widget wrapper applying the staggered fadeUp entrance to a right-column panel.
function Panel({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <div
      className="[animation:cg-fade-up_0.6s_ease_both] motion-reduce:[animation:none]"
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

// The AI-coach console: chat on the left, form + training load on the right.
// Formerly the whole /coach page; since issue #86 it is one section of the
// consolidated coach route, so the page owns the heading and the recommended
// workout (the focus card said the same thing as the workout card above it).
//
// Owns the client-only loading choreography the server page can't: one overlay
// covers the two-column area for a beat, and when it lifts the form bar and the
// 14-day load bars animate in. The view itself is built server-side (demo or
// live) and arrives as a plain-JSON prop.
export function CoachConsole({ view }: { view: CoachView }) {
  const { loading, started } = useStartupReveal();

  return (
    <div className="relative">
      <div className="grid grid-cols-12 items-start gap-4">
        <div className="col-span-12 lg:col-span-7">
          <ChatPanel initialMessages={view.initialMessages} prompts={view.prompts} />
        </div>

        <div className="col-span-12 flex flex-col gap-4 lg:col-span-5">
          <Panel delay={0.14}>
            <FormStatusCard form={view.form} started={started} />
          </Panel>
          <Panel delay={0.2}>
            <TrainingLoadCard load={view.load} started={started} />
          </Panel>
        </div>
      </div>

      <LoadingOverlay show={loading} label="ANALYSERER DIN TRÆNING…" />
    </div>
  );
}
