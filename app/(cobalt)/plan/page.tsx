"use client";

import { useEffect, useMemo, useState } from "react";
import { LoadingOverlay } from "@/components/cobalt/LoadingOverlay";
import { PhaseTimeline } from "@/components/cobalt/plan/PhaseTimeline";
import { PlanHeader } from "@/components/cobalt/plan/PlanHeader";
import { RaceDayCard } from "@/components/cobalt/plan/RaceDayCard";
import { UpcomingWeeks } from "@/components/cobalt/plan/UpcomingWeeks";
import { WeekCalendar } from "@/components/cobalt/plan/WeekCalendar";
import { buildPlanView } from "@/lib/cobalt/plan";

// Plan — the Cobalt Glass training-plan page. Nav + header stay interactive while
// one overlay covers the plan area (timeline → week calendar → upcoming + race)
// for ~2s; when it lifts, the header stats count up and the timeline dots pop in.
export default function PlanPage() {
  const view = useMemo(() => buildPlanView(), []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const started = !loading;

  return (
    <main>
      <PlanHeader
        totalWeeks={view.totalWeeks}
        weekOfPlan={view.weekOfPlan}
        daysToRace={view.daysToRace}
        goalLabel={view.goalLabel}
        started={started}
      />

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
            <RaceDayCard race={view.race} daysToRace={view.daysToRace} />
          </div>
        </div>

        <LoadingOverlay show={loading} label="HENTER DIN PLAN…" />
      </div>
    </main>
  );
}
