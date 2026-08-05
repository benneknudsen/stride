import { GlassCard } from "@/components/cobalt/GlassCard";
import type { UpcomingSession, UpcomingWeek } from "@/lib/cobalt/plan";

// "Kommende uger" — the next block of the plan. Each week says what it actually
// asks of the runner: the calendar dates it covers, the runs it prescribes with
// their distances and pace targets, the volume, and how that volume moves
// against the week before. It used to be one prose line per week ("Sharpen ·
// tempo @ 6:15 /km · uge 2 i blokken") — phase-correct, but nothing you could
// plan a week around. The final down-week reads muted.

const TONE: Record<UpcomingSession["tone"], string> = {
  race: "border-red/45 text-red",
  long: "border-cobalt/30 text-cobalt",
  quality: "border-red/35 text-red",
  easy: "border-cobalt/20 text-ink",
};

function SessionPill({ session, muted }: { session: UpcomingSession; muted: boolean }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] leading-none ${
        muted ? "border-cobalt/20 text-ink" : TONE[session.tone]
      }`}
    >
      <span className="font-medium">{session.label}</span>
      <span className="font-cg-mono text-[11px]">{session.distance}</span>
      {session.pace ? (
        <span className="font-cg-mono text-[10.5px] opacity-70">{session.pace}</span>
      ) : null}
    </span>
  );
}

/**
 * "+3 km" / "−4 km" — how the week's volume moves against the one before it.
 * A flat week renders nothing: the km beside it already says as much, and a
 * "±0" on every row is exactly the kind of noise this widget had too much of.
 */
function VolumeDelta({ deltaKm }: { deltaKm: number }) {
  if (deltaKm === 0) return null;
  const rising = deltaKm > 0;
  return (
    <span className={`font-cg-mono text-[11px] ${rising ? "text-cobalt/80" : "text-ink/70"}`}>
      {rising ? "+" : "−"}
      {Math.abs(deltaKm)} km
    </span>
  );
}

export function UpcomingWeeks({ weeks }: { weeks: UpcomingWeek[] }) {
  const totalKm = weeks.reduce((sum, week) => sum + week.km, 0);

  return (
    <GlassCard className="px-[26px] py-[22px]">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-cg-serif text-[22px] italic text-cobalt">Kommende uger</span>
        <span className="cg-label text-[10.5px] tracking-[0.12em]">
          {weeks.length} uger · {totalKm} km
        </span>
      </div>

      {weeks.map((week, i) => (
        <div
          key={week.id}
          className={`py-3.5 ${i < weeks.length - 1 ? "border-b border-cobalt/15" : ""}`}
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="cg-label text-[11px] tracking-normal text-cobalt">
                Uge {week.week}
              </span>
              <span className="font-cg-mono text-[11px] text-ink/70">{week.dateRange}</span>
              {week.isRaceWeek ? (
                <span className="rounded-pill bg-red px-2 py-0.5 font-cg-mono text-[9px] uppercase tracking-[0.14em] text-onred">
                  Race-uge
                </span>
              ) : null}
            </span>
            <span className="flex flex-none items-baseline gap-2">
              <VolumeDelta deltaKm={week.deltaKm} />
              <span
                className={`font-cg-display text-[16px] font-bold ${
                  week.muted ? "text-ink" : "text-cobalt"
                }`}
              >
                {week.km} km
              </span>
            </span>
          </div>

          <div className="mt-1 font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
            {week.phaseLabel} · {week.phaseProgress} · {week.runCount} løb
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {week.sessions.map((session) => (
              <SessionPill key={session.id} session={session} muted={week.muted} />
            ))}
          </div>
        </div>
      ))}
    </GlassCard>
  );
}
