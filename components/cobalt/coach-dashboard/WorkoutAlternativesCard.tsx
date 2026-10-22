import { GlassCard } from "@/components/cobalt/GlassCard";
import type { AlternativeDistance, WorkoutAlternative } from "@/lib/coach/alternatives";
import { formatDanish } from "@/lib/cobalt/format";

// "Hvis du i stedet…" (issue #342) — the counterpart to "Hvorfor dette pas": what
// the other session types would have meant today, and the engine's own verdict
// on each. Server-rendered from the view-model — no client state, no fetch.
//
// The verdict is a word first (Tilladt / Advarsel / Blokeret), so it never rests
// on colour alone, and every message is the engine's own text: a blocked line
// never carries a recovery time the engine did not give.

/** How one status is written: the word, its tone and the rule that marks it. */
interface StatusStyle {
  word: string;
  tone: string;
  border: string;
}

/**
 * One row per status, in the trace card's own colours. The word carries the
 * verdict, not the hue.
 */
const STATUS: Record<WorkoutAlternative["status"], StatusStyle> = {
  allowed: { word: "Tilladt", tone: "text-ink/80", border: "border-cobalt/25" },
  warning: { word: "Advarsel", tone: "text-cobalt", border: "border-ink/40" },
  blocked: { word: "Blokeret", tone: "text-red", border: "border-red/70" },
};

/** A distance in Danish decimals — "8" and "7,5", never "8.0". */
function km(value: number): string {
  return formatDanish(value, Number.isInteger(value) ? 0 : 1);
}

/**
 * The distance band as the runner reads it: a range where the phase allows one,
 * a single figure where the engine pins the distance itself.
 */
function distanceLabel(distance: AlternativeDistance): string {
  if (distance.minKm === distance.maxKm) return `${km(distance.minKm)} km`;
  return `${km(distance.minKm)}–${km(distance.maxKm)} km`;
}

export function WorkoutAlternativesCard({ alternatives }: { alternatives: WorkoutAlternative[] }) {
  return (
    <GlassCard className="flex flex-col gap-4 p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Hvis du i stedet…</span>
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
          Motorens dom
        </span>
      </div>

      {alternatives.length === 0 ? (
        <p className="m-0 text-[12.5px] leading-snug text-ink/80">
          Der er ingen andre pas-typer at veksle imellem i dag.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="coach-alternatives">
          {alternatives.map((alternative) => {
            // The engine's verdict as it is: the blocking rules first, then the
            // cautions. A blocked line still carries warnings, so both lists
            // are rendered — only the tone differs.
            const verdict = [
              ...alternative.issues.map((entry) => ({ entry, blocked: true })),
              ...alternative.warnings.map((entry) => ({ entry, blocked: false })),
            ];
            const status = STATUS[alternative.status];
            return (
              <li
                key={alternative.type}
                className={`flex flex-col gap-1.5 border-l-2 pl-3 ${status.border}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`cg-label text-[10px] tracking-[0.14em] ${status.tone}`}>
                    {status.word}
                  </span>
                  <span className="text-[13px] font-semibold text-cobalt">{alternative.label}</span>
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-cg-mono text-[11.5px] tabular-nums text-ink/80">
                  <span>{distanceLabel(alternative.distance)}</span>
                  <span>Zone {alternative.zone}</span>
                  <span>
                    {alternative.paceRange.min}–{alternative.paceRange.max} /km
                  </span>
                </div>

                {verdict.map(({ entry, blocked }) => (
                  <div
                    key={`${blocked ? "issue" : "warning"}-${entry.id}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="cg-label-sm tracking-[0.12em] text-ink/60">{entry.label}</span>
                    <p
                      className={`m-0 text-[12.5px] leading-snug ${blocked ? "text-ink" : "text-ink/70"}`}
                    >
                      {entry.message}
                    </p>
                    {entry.suggestion ? (
                      <p className="m-0 text-[12.5px] leading-snug text-ink/80">
                        {entry.suggestion}
                      </p>
                    ) : null}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}
