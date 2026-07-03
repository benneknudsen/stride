"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChatPanel } from "@/components/cobalt/coach/ChatPanel";
import { CoachHeader } from "@/components/cobalt/coach/CoachHeader";
import { FocusCard } from "@/components/cobalt/coach/FocusCard";
import { FormStatusCard } from "@/components/cobalt/coach/FormStatusCard";
import { TrainingLoadCard } from "@/components/cobalt/coach/TrainingLoadCard";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { buildCoachView } from "@/lib/cobalt/coach";

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

// Coach — the Cobalt Glass chat page. Nav + header stay interactive while one
// overlay covers the two-column area (chat + dashboards) for ~2s; when it lifts,
// the form bar and 14-day load bars animate in.
export default function CoachPage() {
  const view = useMemo(() => buildCoachView(), []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const started = !loading;

  return (
    <main>
      <CoachHeader activityCount={view.activityCount} />

      {/* Chat + dashboards: covered by one loading overlay; nav + header stay
          clickable. */}
      <div className="relative pt-2">
        <div className="grid grid-cols-12 items-start gap-4">
          <div className="col-span-12 lg:col-span-7">
            <ChatPanel
              initialMessages={view.initialMessages}
              prompts={view.prompts}
              replies={view.replies}
            />
          </div>

          <div className="col-span-12 flex flex-col gap-4 lg:col-span-5">
            <Panel delay={0.14}>
              <FocusCard quote={view.focusQuote} />
            </Panel>
            <Panel delay={0.2}>
              <FormStatusCard form={view.form} started={started} />
            </Panel>
            <Panel delay={0.26}>
              <TrainingLoadCard load={view.load} started={started} />
            </Panel>
          </div>
        </div>

        <LoadingOverlay show={loading} label="ANALYSERER DIN TRÆNING…" />
      </div>
    </main>
  );
}
