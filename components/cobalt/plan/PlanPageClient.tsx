"use client";

import { useState } from "react";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { PhaseTimeline } from "@/components/cobalt/plan/PhaseTimeline";
import { PlanHeader } from "@/components/cobalt/plan/PlanHeader";
import { RaceDateDialog } from "@/components/cobalt/plan/RaceDateDialog";
import { RaceDayCard } from "@/components/cobalt/plan/RaceDayCard";
import { UpcomingWeeks } from "@/components/cobalt/plan/UpcomingWeeks";
import { WeekCalendar } from "@/components/cobalt/plan/WeekCalendar";
import { useStartupReveal } from "@/hooks/useStartupReveal";
import type { PlanView } from "@/lib/cobalt/plan";

// Plan — the Cobalt Glass training-plan page. Owns the client-only loading
// choreography the server page can't: nav + header stay interactive while one
// overlay covers the plan area (timeline → week calendar → upcoming + race)
// for a beat; when it lifts, the header stats count up and the timeline dots pop
// in. The view itself is built server-side (demo or live) and arrives as a
// plain-JSON prop.
//
// Race editing (issue #99): signed-in users (`canEditRace`) get the
// RaceDateDialog, reachable from the race card's "Skift race" button and from
// two CTA states — the demo-plan badge (no own race chosen yet) and the
// race-completed banner (the chosen race date has passed).
export function PlanPageClient({
  view,
  canEditRace = false,
  hasOwnRace = false,
}: {
  view: PlanView;
  /** Signed-in — the race dialog and CTAs are available. */
  canEditRace?: boolean;
  /** The user has picked their own race (users.race_date is set). */
  hasOwnRace?: boolean;
}) {
  const { loading, started } = useStartupReveal();
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = () => setDialogOpen(true);

  return (
    <main>
      <PlanHeader
        planTitle={view.planTitle}
        totalWeeks={view.totalWeeks}
        weekOfPlan={view.weekOfPlan}
        daysToRace={view.daysToRace}
        goalLabel={view.goalLabel}
        started={started}
      />

      {canEditRace && !hasOwnRace ? (
        <div className="px-3 pb-1 [animation:cg-fade-up_0.6s_0.04s_ease_both] motion-reduce:[animation:none]">
          <button
            type="button"
            onClick={openDialog}
            className="cg-interactive rounded-pill border border-cobalt/30 px-[16px] py-[6px] font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-cobalt transition-colors hover:bg-cobalt/8"
          >
            Demo-plan — vælg din egen race →
          </button>
        </div>
      ) : null}

      {canEditRace && hasOwnRace && view.racePassed ? (
        <div className="px-3 pb-1 [animation:cg-fade-up_0.6s_0.04s_ease_both] motion-reduce:[animation:none]">
          <button
            type="button"
            onClick={openDialog}
            className="cg-interactive rounded-pill border border-red/40 px-[16px] py-[6px] font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-red transition-colors hover:bg-red/8"
          >
            Race gennemført — vælg din næste race →
          </button>
        </div>
      ) : null}

      {/* Plan area: covered by one loading overlay; nav + header stay clickable. */}
      <div className="relative pt-2">
        <div className="[animation:cg-fade-up_0.6s_0.08s_ease_both] motion-reduce:[animation:none]">
          <PhaseTimeline
            markers={view.phaseMarkers}
            segments={view.phaseSegments}
            started={started}
          />
        </div>

        <WeekCalendar
          weekOfPlan={view.weekOfPlan}
          plannedKm={view.weekPlannedKm}
          doneKm={view.weekDoneKm}
          days={view.days}
        />

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[7fr_5fr]">
          <div className="[animation:cg-fade-up_0.6s_0.3s_ease_both] motion-reduce:[animation:none]">
            <UpcomingWeeks weeks={view.upcomingWeeks} />
          </div>
          <div className="[animation:cg-fade-up_0.6s_0.36s_ease_both] motion-reduce:[animation:none]">
            <RaceDayCard
              race={view.race}
              daysToRace={view.daysToRace}
              onEdit={canEditRace ? openDialog : undefined}
            />
          </div>
        </div>

        <LoadingOverlay show={loading} label="HENTER DIN PLAN…" />
      </div>

      {canEditRace ? (
        <RaceDateDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          currentDateValue={view.race.dateValue}
          currentName={hasOwnRace ? view.race.name : ""}
        />
      ) : null}
    </main>
  );
}
