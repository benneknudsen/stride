import { GlassCard } from "@/components/cobalt/GlassCard";
// One formatter for the plan's distances, so a run line reads "21,1 km" on a race
// row and the race card's chip says the same thing — never "12.5 km" from a raw
// number, and never "21 km" beside a "21,1 km" chip (issue #291).
import { formatDistanceKm } from "@/lib/cobalt/format";
import type { SessionTone, UpcomingWeek } from "@/lib/cobalt/plan";

// "Kommende uger" — the next block of the plan. Each row answers three questions
// the old one-liner did not: which calendar week this is, what to actually run,
// and how the volume moves against the week before (issue #291). The easy days
// come as a single grouped line, the hard efforts keep their own, and the race
// week is marked so it can't be misread as another build week.

/** Tailwind classes per run kind — literals, not interpolated, so the scanner sees them. */
const TONE_CLASS: Record<SessionTone, string> = {
  race: "text-red",
  long: "text-cobalt",
  quality: "text-red",
  easy: "text-ink",
};

/**
 * "Uge 2 af 4", but only when it says something: a one-week phase has nothing to
 * count towards, and a week the phase no longer contains (the post-race week,
 * where `getCurrentPhase` still answers "peak") would print a false count.
 */
function phaseCounter(week: UpcomingWeek): string | null {
  if (week.phaseTotal <= 1 || week.weekInPhase > week.phaseTotal) return null;
  return `Uge ${week.weekInPhase} af ${week.phaseTotal}`;
}

/** The signed volume change, or nothing on the first row — see `deltaKm`. */
function deltaLabel(deltaKm: number | null): string | null {
  if (deltaKm === null) return null;
  // A real minus sign, not a hyphen: the card sets these in the serif face.
  return `${deltaKm < 0 ? "−" : "+"}${Math.abs(deltaKm)} km`;
}

export function UpcomingWeeks({ weeks }: { weeks: UpcomingWeek[] }) {
  return (
    <GlassCard className="px-[26px] py-[22px]">
      <div className="mb-3.5 font-cg-serif text-[22px] italic text-cobalt">Kommende uger</div>

      {weeks.map((week, i) => {
        const counter = phaseCounter(week);
        const delta = deltaLabel(week.deltaKm);
        return (
          <div
            key={week.id}
            className={`py-3 ${i < weeks.length - 1 ? "border-b border-cobalt/15" : ""}`}
            data-testid="upcoming-week-row"
          >
            <div className="flex items-center gap-4">
              <span className="w-14 flex-none cg-label text-[11px] tracking-normal">
                Uge {week.week}
              </span>
              <span className="flex-1 text-[14px] font-medium text-cobalt">{week.focus}</span>
              {week.isRaceWeek ? (
                <span
                  className="cg-label-sm rounded-pill border border-red/40 px-2 py-0.5 text-red"
                  data-testid="race-week-flag"
                >
                  Race
                </span>
              ) : null}
              <span
                className={`font-cg-display text-[16px] font-bold ${
                  week.muted ? "text-ink" : "text-cobalt"
                }`}
              >
                {week.km} km
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 pl-18 text-[12px] text-ink">
              <span className="cg-label-sm tracking-normal">{week.dateLabel}</span>
              {counter ? (
                <span className="cg-label-sm tracking-normal" data-testid="phase-counter">
                  {counter}
                </span>
              ) : null}
              <span>{week.runCount} løbedage</span>
              {delta ? (
                <span className="cg-label-sm tracking-normal" data-testid="week-delta">
                  {delta}
                </span>
              ) : null}
            </div>

            <ul className="mt-2 pl-18">
              {week.sessions.map((session) => (
                <li key={session.id} className="flex items-baseline gap-2 py-0.5 text-[13px]">
                  <span className={`font-medium ${TONE_CLASS[session.tone]}`}>{session.label}</span>
                  <span className="font-cg-display text-[12px] text-ink">
                    {formatDistanceKm(session.distanceKm)}
                  </span>
                  <span className="cg-label-sm tracking-normal text-ink">
                    {session.pace ?? "–"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </GlassCard>
  );
}
