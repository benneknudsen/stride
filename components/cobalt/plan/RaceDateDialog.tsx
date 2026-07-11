"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { saveRacePlan } from "@/actions/race";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { getCurrentPhase } from "@/lib/coach/engine";

const DAY_MS = 86_400_000;
/** Below this many weeks to race, the dialog warns that the plan starts mid-build. */
const SHORT_RUNWAY_WEEKS = 6;

/** "YYYY-MM-DD" (a date-input value) as a local calendar day, or null. */
function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getDate() === Number(match[3]) ? date : null;
}

// Race picker (issue #99) — a client dialog over the plan page. The date field
// is a native <input type="date"> (day-granular, no timezone), the name is
// free text, and saving goes through the saveRacePlan server action followed
// by router.refresh() so every force-dynamic page re-anchors immediately.
export function RaceDateDialog({
  open,
  onClose,
  currentDateValue,
  currentName,
}: {
  open: boolean;
  onClose: () => void;
  /** The race date currently driving the plan, as a date-input value. */
  currentDateValue: string;
  /** The race name currently shown, prefilled as a starting point. */
  currentName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dateValue, setDateValue] = useState(currentDateValue);
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the fields each time the dialog opens with what the page shows now.
  useEffect(() => {
    if (open) {
      setDateValue(currentDateValue);
      setName(currentName);
      setError(null);
    }
  }, [open, currentDateValue, currentName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Advisory lines, recomputed as the user picks a date: a short-runway warning
  // under 6 weeks, and a note when the switch moves today's training phase (the
  // week's recommendation changes with it). Both read the pure engine directly.
  const { shortRunway, phaseShift } = useMemo(() => {
    const selected = parseDateValue(dateValue);
    if (!selected) return { shortRunway: false, phaseShift: null };
    const now = new Date();
    const weeksOut = (selected.getTime() - now.getTime()) / (7 * DAY_MS);
    const current = parseDateValue(currentDateValue);
    const fromPhase = getCurrentPhase(now, current ?? undefined);
    const toPhase = getCurrentPhase(now, selected);
    return {
      shortRunway: weeksOut >= 0 && weeksOut < SHORT_RUNWAY_WEEKS,
      phaseShift: fromPhase !== toPhase ? { from: fromPhase, to: toPhase } : null,
    };
  }, [dateValue, currentDateValue]);

  if (!open) return null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveRacePlan({
        raceDate: dateValue,
        raceName: name.trim() ? name.trim() : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* The backdrop is a real button so click-to-close is keyboard/AT-reachable. */}
      <button
        type="button"
        aria-label="Luk"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-cobalt/20 backdrop-blur-sm"
      />
      <GlassCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="race-dialog-title"
        className="relative w-full max-w-[420px] px-[26px] py-[24px] [animation:cg-fade-up_0.3s_ease_both] motion-reduce:[animation:none]"
      >
        <span className="font-cg-mono text-[10px] uppercase tracking-[0.18em] text-red">
          Din race
        </span>
        <h2
          id="race-dialog-title"
          className="mt-1 mb-4 font-cg-serif text-[24px] italic leading-[1.15] text-cobalt"
        >
          Vælg din race
        </h2>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
              Race-dato
            </span>
            <input
              type="date"
              required
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="cg-interactive rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 font-cg-mono text-[13px] text-cobalt outline-none focus:border-cobalt"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink">
              Racenavn (valgfrit)
            </span>
            <input
              type="text"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Silkeborg Halvmarathon"
              className="cg-interactive rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 text-[13.5px] text-cobalt outline-none placeholder:text-ink/50 focus:border-cobalt"
            />
          </label>

          {shortRunway ? (
            <p className="m-0 text-[12px] leading-snug text-red">
              Under {SHORT_RUNWAY_WEEKS} uger til race — planen starter midt i forløbet, så
              basefaserne bliver korte.
            </p>
          ) : null}

          {phaseShift ? (
            <p className="m-0 text-[12px] leading-snug text-ink">
              Skiftet flytter din aktuelle fase fra{" "}
              <span className="font-semibold text-cobalt">{phaseShift.from}</span> til{" "}
              <span className="font-semibold text-cobalt">{phaseShift.to}</span> — ugens
              anbefaling ændrer sig.
            </p>
          ) : null}

          {error ? <p className="m-0 text-[12px] leading-snug text-red">{error}</p> : null}

          <div className="mt-1 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="cg-interactive rounded-pill px-[18px] py-[7px] font-cg-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-cobalt/8"
            >
              Annullér
            </button>
            <button
              type="submit"
              disabled={pending}
              className="cg-interactive rounded-pill bg-cobalt px-[18px] py-[7px] font-cg-mono text-[11px] uppercase tracking-[0.12em] text-silver transition-opacity disabled:opacity-60"
            >
              {pending ? "Gemmer…" : "Gem race"}
            </button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
