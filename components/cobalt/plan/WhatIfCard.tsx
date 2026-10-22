"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { HALF_MARATHON_KM } from "@/lib/coach/engine";
import type { RaceScenario } from "@/lib/cobalt/plan";
import { gapDuration, gapSentence, goalClock, goalGap, goalPaceLabel } from "@/lib/cobalt/whatif";

// "Hvad hvis" (issue #340) — the plan's second look. The race card answers one
// question ("what does my race look like?"); this one asks what the runner's
// *current* basis reaches at another distance, and how far their own goal sits
// from it. The projections are the predictor's, computed server-side — the card
// only chooses a distance and does arithmetic on the numbers it is handed, so no
// activity ever reaches the browser.
//
// The honesty rules ride along: a distance the predictor can't reach shows that
// distance's own lock instead of a number, the confidence is on the card, and
// the gap says nothing more than what it is — the difference between two
// numbers.

/** The longest goal the card accepts — a day is already past absurd. */
const MAX_GOAL_MINUTES = 1440;

function Stat({ value, label, testId }: { value: string | null; label: string; testId?: string }) {
  return (
    <div>
      <div
        className="font-cg-display text-[20px] font-extrabold leading-none tabular-nums"
        data-testid={testId}
      >
        {value}
      </div>
      <div className="mt-1.5 cg-label-sm opacity-85">{label}</div>
    </div>
  );
}

export function WhatIfCard({
  scenarios,
  signedIn = false,
}: {
  /** The server-side scenarios — one per standard distance. */
  scenarios: RaceScenario[];
  /**
   * Signed in — the empty state points at the race dialog instead of at
   * sign-in, because a signed-in runner without a race has a next step.
   */
  signedIn?: boolean;
}) {
  // The card opens where the runner already is: on their own race distance when
  // it is one of the four, on the half marathon otherwise.
  const [selected, setSelected] = useState(() => {
    const own = scenarios.findIndex((item) => item.isOwnRace);
    if (own >= 0) return own;
    const half = scenarios.findIndex((item) => item.distanceKm === HALF_MARATHON_KM);
    return half >= 0 ? half : 0;
  });
  // The runner's own edit to the goal; null means "the scenario's own default".
  const [goalMinutes, setGoalMinutes] = useState<number | null>(null);
  // The field keeps a string draft so it can stand empty mid-typing; null means
  // "no draft" — the field shows the current goal.
  const [draft, setDraft] = useState<string | null>(null);

  const scenario = scenarios[selected] ?? null;
  const defaultMinutes = scenario?.defaultGoalSeconds
    ? Math.round(scenario.defaultGoalSeconds / 60)
    : 0;
  const minutes = goalMinutes ?? defaultMinutes;
  // The field may be edited freely, so the draft is a string: it can stand
  // empty or half-typed while the number behind it only moves on valid input.
  const draftNumber = draft === null ? minutes : Number(draft);
  const shownValue =
    draft !== null && Number.isFinite(draftNumber) && draftNumber > 0
      ? String(Math.min(draftNumber, MAX_GOAL_MINUTES))
      : (draft ?? String(minutes));

  /** Normalises the draft: empty or invalid falls back to the current goal. */
  const normalizeDraft = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(null);
      return;
    }
    const clamped = Math.min(parsed, MAX_GOAL_MINUTES);
    setGoalMinutes(clamped);
    setDraft(String(clamped));
  };
  const goalSeconds = minutes * 60;
  const gap =
    scenario && scenario.timeSeconds !== null
      ? goalGap(goalSeconds, scenario.timeSeconds, scenario.distanceKm)
      : null;

  return (
    <GlassCard className="px-[26px] py-[22px]" data-testid="what-if-card">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Hvad hvis</span>
        <span className="cg-label-sm opacity-70">Nuværende fundament</span>
      </div>

      {scenarios.length === 0 ? (
        <p
          className="m-0 max-w-[42ch] text-[13px] leading-[1.45] text-ink"
          data-testid="whatif-empty"
        >
          {signedIn
            ? "Vælg din egen race, så vi kan regne på dine egne løbedata."
            : "Log ind og synkronisér dine løbeture, så vi kan regne på hvad dit fundament rækker til."}
        </p>
      ) : (
        <>
          <fieldset className="m-0 border-0 p-0">
            <legend className="cg-label-sm mb-1.5 p-0 opacity-85">Distance</legend>
            <div className="flex flex-wrap gap-2">
              {scenarios.map((item, index) => {
                const active = index === selected;
                return (
                  <button
                    key={item.distanceKm}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${item.label} · ${item.distanceKmLabel}`}
                    onClick={() => {
                      setSelected(index);
                      // A goal belongs to the distance it was set for.
                      setGoalMinutes(null);
                      setDraft(null);
                    }}
                    className={`cg-interactive rounded-pill border px-[12px] py-[6px] cg-label-sm tracking-[0.1em] transition-colors ${
                      active
                        ? "border-cobalt bg-cobalt text-silver"
                        : "border-cobalt/30 text-cobalt hover:bg-cobalt/8"
                    }`}
                  >
                    {item.distanceKmLabel}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {scenario?.lock ? (
            <div
              className="mt-[18px] flex items-start gap-3 rounded-[14px] border border-cobalt/25 bg-cobalt/8 px-3.5 py-3"
              data-testid="whatif-lock"
            >
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 opacity-85" />
              <div>
                <div className="cg-label-sm opacity-85">Prognosen låst</div>
                <p className="mt-1.5 max-w-[38ch] text-[13px] leading-[1.45]">
                  {scenario.lock.message}
                </p>
              </div>
            </div>
          ) : scenario ? (
            <>
              <div className="mt-[18px]">
                <div
                  className="font-cg-display text-[40px] font-extrabold leading-none tabular-nums"
                  data-testid="whatif-estimate"
                >
                  {scenario.estimate}
                </div>
                <div className="mt-2 cg-label-sm opacity-85">Prognose · {scenario.label}</div>
              </div>

              <div className="mt-[18px] flex flex-wrap gap-[26px]">
                <Stat label="Pace" value={scenario.paceRange} testId="whatif-pace" />
                <Stat
                  label="Sikkerhed"
                  value={scenario.confidenceLabel}
                  testId="whatif-confidence"
                />
              </div>

              <div className="mt-[18px]">
                <label htmlFor="whatif-goal" className="cg-label-sm opacity-85">
                  Måltid
                </label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input
                    id="whatif-goal"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_GOAL_MINUTES}
                    step={1}
                    value={shownValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraft(next);
                      const parsed = Number(next);
                      // A number field takes whatever is typed; a valid number
                      // moves the goal live, so the gap follows along.
                      if (Number.isFinite(parsed) && parsed > 0) {
                        setGoalMinutes(Math.min(parsed, MAX_GOAL_MINUTES));
                      }
                    }}
                    onBlur={normalizeDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") normalizeDraft();
                    }}
                    className="cg-interactive w-[92px] rounded-pill border border-cobalt/30 bg-white/60 px-3 py-1.5 font-cg-mono text-[13px] tabular-nums text-cobalt outline-none focus:border-cobalt"
                  />
                  <span className="cg-label-sm opacity-70">min</span>
                  <span className="cg-label-sm opacity-70" data-testid="whatif-goal-clock">
                    ≈ {goalClock(goalSeconds)}
                  </span>
                </div>
              </div>

              {gap ? (
                <div className="mt-[18px] border-t border-cobalt/15 pt-3">
                  <p
                    className="m-0 max-w-[40ch] text-[13px] leading-[1.45]"
                    data-testid="whatif-gap"
                  >
                    {gapSentence(gap)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-[18px]">
                    <span className="cg-label-sm opacity-70" data-testid="whatif-gap-duration">
                      Heltid: {gapDuration(gap)}
                    </span>
                    <span className="cg-label-sm opacity-70" data-testid="whatif-goal-pace">
                      Målpace: {goalPaceLabel(gap)} /km
                    </span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </GlassCard>
  );
}
