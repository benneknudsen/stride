import { GlassCard } from "@/components/cobalt/GlassCard";
import type { WorkoutCardView } from "@/lib/coach/dashboard";
import type { ConstraintTrace } from "@/lib/coach/engine";

// "Hvorfor dette pas" (issue #301) — the deterministic engine's audit trail for
// the "Næste pas" card above it: the recommender's own interventions, the rules
// that blocked or warned, and — folded into a native <details> — every rule
// that passed or was out of play for the phase. Server-rendered from the
// recommendation's carried trace; no client fetch, no extra DB read. Native
// <details> keeps the folded half working without JS.

const STATUS_LABELS: Record<ConstraintTrace["status"], string> = {
  blocked: "Blokeret",
  warning: "Advarsel",
  passed: "Passeret",
  "not-applicable": "Ikke i spil",
};

export function WorkoutTraceCard({ workout }: { workout: WorkoutCardView }) {
  const shaping = workout.trace.filter(
    (entry) => entry.status === "blocked" || entry.status === "warning"
  );
  const folded = workout.trace.filter(
    (entry) => entry.status === "passed" || entry.status === "not-applicable"
  );
  const passedCount = folded.filter((entry) => entry.status === "passed").length;

  return (
    <GlassCard className="flex flex-col gap-4 p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cg-label tracking-[0.18em]">Hvorfor dette pas</span>
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
          Motorens regler
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-red">
          Motorens indgreb
        </span>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {workout.reason.map((line) => (
            <li key={line} className="flex gap-2 text-[13px] leading-snug text-ink">
              <span aria-hidden="true" className="text-red">
                ●
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>

      {shaping.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {shaping.map((entry) => (
            <li
              key={entry.id}
              className={`flex flex-col gap-1 border-l-2 pl-3 ${
                entry.status === "blocked" ? "border-red/70" : "border-ink/30"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`cg-label text-[10px] tracking-[0.14em] ${
                    entry.status === "blocked" ? "text-red" : "text-cobalt"
                  }`}
                >
                  {STATUS_LABELS[entry.status]}
                </span>
                <span className="text-[13px] font-semibold text-cobalt">{entry.label}</span>
              </div>
              <p className="m-0 text-[12.5px] leading-snug text-ink">{entry.detail}</p>
              {entry.suggestion ? (
                <p className="m-0 text-[12.5px] leading-snug text-ink/80">{entry.suggestion}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : workout.trace.length === 0 ? (
        <p className="m-0 text-[12.5px] leading-snug text-ink/80">
          Dagen er lagt som hviledag af motorens egne grunde (se linjerne ovenfor) — derfor blev der
          ikke kørt en regelvalidering.
        </p>
      ) : (
        <p className="m-0 text-[12.5px] leading-snug text-ink/80">
          Ingen regler havde indvendinger mod dagens pas.
        </p>
      )}

      {folded.length > 0 ? (
        <details className="group border-t border-cobalt/10 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="font-cg-mono text-[11px] text-ink/70 transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/70">
              Se alle {workout.trace.length} regler · {passedCount} passerede ·{" "}
              {folded.length - passedCount} ikke i spil
            </span>
          </summary>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
            {folded.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5">
                <span className="font-cg-mono text-[10.5px] uppercase tracking-[0.12em] text-ink/60">
                  {entry.label} · {STATUS_LABELS[entry.status]}
                </span>
                <span className="text-[12px] leading-snug text-ink/70">{entry.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </GlassCard>
  );
}
