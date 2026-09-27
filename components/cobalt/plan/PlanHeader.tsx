import { CountUpNumber } from "@/components/cobalt/CountUpNumber";

// Plan header: red mono label ("TRÆNINGSPLAN · SILKEBORG HALVMARATHON") + a
// two-line serif-italic headline, with two big count-up stats on the right
// (week of plan, days to race). The label comes from the view-model (issue
// #99 — it carries the user's race name). Sits on the silver paper (no glass),
// outside the loading overlay, so it stays interactive while the plan below
// loads. `started` flips the stats from their dimmed pulsing 0-state into the
// count-up.

const GOAL_PREFIX = "Mål under ";

/**
 * The headline. "Mål under 1:55" became "Ét mål: halvmaraton under 1:55"
 * (issue #291) — the goal was never attached to a distance, so the strongest
 * sentence on the page named a time and nothing else. Only the "Mål under …"
 * shape can take a distance; any other goal ("Mål på vej", from a locked
 * estimate) takes the same "Mål" → "Ét mål:" rename without one, and a null goal
 * falls back to the neutral headline.
 *
 * Every branch returns a dotless sentence: the JSX below owns the single period,
 * so a branch can't add one of its own and print "Klar til race..".
 */
function headline(goalLabel: string | null, distanceInline: string): string {
  if (!goalLabel) return "Klar til race";
  if (goalLabel.startsWith(GOAL_PREFIX)) {
    return `Ét mål: ${distanceInline} under ${goalLabel.slice(GOAL_PREFIX.length)}`;
  }
  return goalLabel.replace(/^Mål/, "Ét mål:");
}

export function PlanHeader({
  planTitle,
  totalWeeks,
  weekOfPlan,
  daysToRace,
  goalLabel,
  distanceInline,
  started,
}: {
  planTitle: string;
  totalWeeks: number;
  weekOfPlan: number;
  daysToRace: number;
  /** Derived goal ("Mål under 1:55"); null falls back to a neutral headline. */
  goalLabel: string | null;
  /** The race distance mid-sentence ("halvmaraton") — names the goal. */
  distanceInline: string;
  started: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 px-3 pt-[38px] pb-1.5">
      <div className="[animation:cg-fade-up_0.7s_ease_both] motion-reduce:[animation:none]">
        <div className="mb-3 cg-label text-[11px] tracking-[0.2em] text-red">{planTitle}</div>
        <h1 className="m-0 font-cg-serif text-[42px] italic leading-[1.02] tracking-[-0.015em] text-cobalt sm:text-[54px]">
          {totalWeeks} uger.
          <br />
          {headline(goalLabel, distanceInline)}.
        </h1>
      </div>

      <div className="flex gap-9 [animation:cg-fade-up_0.7s_0.1s_ease_both] motion-reduce:[animation:none]">
        <div className="flex flex-col items-end">
          <CountUpNumber
            value={weekOfPlan}
            run={started}
            className="items-end text-[44px] text-cobalt"
          />
          <span className="mt-2 cg-label tracking-[0.16em]">Uge af {totalWeeks}</span>
        </div>
        <div className="flex flex-col items-end">
          <CountUpNumber
            value={daysToRace}
            run={started}
            className="items-end text-[44px] text-red"
          />
          <span className="mt-2 cg-label tracking-[0.16em]">Dage til race</span>
        </div>
      </div>
    </header>
  );
}
