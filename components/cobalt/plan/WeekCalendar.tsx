import type { DayPlan, PlanTone } from "@/lib/cobalt/plan";

const TONE_CLASS: Record<PlanTone, string> = {
  cobalt: "text-cobalt",
  red: "text-red",
  muted: "text-ink",
};

// One day column. Styling varies by kind: done/planned are frosted glass, today
// gets a cobalt border + pulsing dot, the AI-recommended session is a cobalt
// surface with the red spark, and rest days are a dashed muted tile.
function DayCard({ day }: { day: DayPlan }) {
  const base = "flex min-h-[150px] flex-col gap-2 rounded-card p-4";

  if (day.kind === "rest") {
    return (
      <div
        className={`${base} border border-dashed border-cobalt/25`}
        style={{ background: "rgba(255,255,255,0.28)" }}
      >
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
          {day.dow}
        </span>
        <div className="text-[13.5px] font-semibold text-ink">{day.name}</div>
        <div className="text-[11.5px] text-ink">{day.zoneLabel}</div>
      </div>
    );
  }

  if (day.kind === "ai") {
    return (
      <div className={`cg-glass-cobalt ${base} text-silver`}>
        <div className="flex items-center justify-between">
          <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-silver/70">
            {day.dow}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z"
              fill="var(--color-red)"
            />
          </svg>
        </div>
        <div className="text-[13.5px] font-semibold">{day.name}</div>
        <div className="text-[11.5px] text-silver/75">
          {day.distance ? `${day.distance} · ` : ""}
          {day.zoneLabel}
        </div>
        {day.meta ? (
          <div className="mt-auto font-cg-mono text-[10.5px] text-silver">{day.meta}</div>
        ) : null}
      </div>
    );
  }

  const today = day.kind === "today";

  return (
    <div
      className={`cg-glass ${base}`}
      style={today ? { border: "1.5px solid var(--color-cobalt)" } : undefined}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-cg-mono text-[10px] uppercase tracking-[0.14em] ${
            today ? "font-semibold text-cobalt" : "text-ink"
          }`}
        >
          {day.dow}
        </span>
        {/* The ✓ marks a session that was actually run — never one still ahead. */}
        {today ? (
          <span className="size-[7px] rounded-full bg-cobalt [animation:cg-pulse-dot_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
        ) : day.kind === "done" ? (
          <span className="text-[13px] text-success-ink">✓</span>
        ) : null}
      </div>
      <div className="text-[13.5px] font-semibold text-cobalt">{day.name}</div>
      <div className="text-[11.5px] text-ink">
        {day.distance ? `${day.distance} · ` : ""}
        <span
          className={`${TONE_CLASS[day.zoneTone]} ${day.zoneTone === "red" ? "font-semibold" : ""}`}
        >
          {day.zoneLabel}
        </span>
      </div>
      {day.meta ? (
        <div className={`mt-auto font-cg-mono text-[10.5px] ${TONE_CLASS[day.metaTone]}`}>
          {day.meta}
        </div>
      ) : null}
    </div>
  );
}

// This week's plan: header row (serif title + mono volume) and a 7-column grid
// of day cards. Each card fades up staggered left→right.
export function WeekCalendar({
  weekOfPlan,
  plannedKm,
  doneKm,
  days,
}: {
  weekOfPlan: number;
  plannedKm: number;
  doneKm: number;
  days: DayPlan[];
}) {
  const doneLabel = doneKm.toFixed(1).replace(".", ",");

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 pt-[26px] pb-3">
        <span className="font-cg-serif text-[24px] italic text-cobalt">
          Denne uge — uge {weekOfPlan}
        </span>
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink">
          {plannedKm} km planlagt · {doneLabel} gennemført
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((day, i) => (
          <div
            key={day.id}
            className="[animation:cg-fade-up_0.5s_ease_both] motion-reduce:[animation:none]"
            style={{ animationDelay: `${0.1 + i * 0.05}s` }}
          >
            <DayCard day={day} />
          </div>
        ))}
      </div>
    </section>
  );
}
