"use client";

import { track } from "@vercel/analytics";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { saveRacePlan } from "@/actions/race";
import { GlassCard } from "@/components/cobalt/GlassCard";
import { getCurrentPhase } from "@/lib/coach/engine";

const DAY_MS = 86_400_000;
/** Below this many weeks to race, the dialog warns that the plan starts mid-build. */
const SHORT_RUNWAY_WEEKS = 6;

/** The race distances the picker offers (issue #238), plus a custom escape hatch. */
const DISTANCE_PRESETS = [
  { id: "10", label: "10K", km: 10 },
  { id: "half", label: "Halvmaraton", km: 21.0975 },
  { id: "marathon", label: "Maraton", km: 42.195 },
  { id: "custom", label: "Andet", km: null },
] as const;

type DistancePresetId = (typeof DISTANCE_PRESETS)[number]["id"];

/** How the user is entering their goal (issue #238): not at all, a time, or a pace. */
type GoalMode = "none" | "time" | "pace";

/** "YYYY-MM-DD" (a date-input value) as a local calendar day, or null. */
function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getDate() === Number(match[3]) ? date : null;
}

/** Which preset a stored distance maps to — an exact preset, else "custom". */
function presetForKm(km: number | null | undefined): DistancePresetId {
  if (km == null) return "half"; // no stored distance → today's default
  for (const preset of DISTANCE_PRESETS) {
    if (preset.km !== null && Math.abs(preset.km - km) < 0.01) return preset.id;
  }
  return "custom";
}

/** The km a picker state resolves to, or null when the custom input is empty/invalid. */
function resolveDistanceKm(preset: DistancePresetId, customKm: string): number | null {
  if (preset === "custom") {
    const value = Number(customKm.replace(",", "."));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return DISTANCE_PRESETS.find((d) => d.id === preset)?.km ?? null;
}

/** "m:ss" or "h:mm:ss" (also "mm:ss") → total seconds, or null when malformed. */
function parseClock(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const nums = parts.map(Number);
  if (parts.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }
  const [hours, minutes, seconds] = nums;
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Seconds → "m:ss" under an hour, "h:mm:ss" at or above one. */
function formatClock(totalSeconds: number): string {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A pace in seconds/km as "m:ss". */
function formatPaceSeconds(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Race picker (issue #99, #238) — a client dialog over the plan page. The date
// field is a native <input type="date"> (day-granular, no timezone), the name is
// free text, the distance is a segmented control (preset or custom km), and the
// goal is optional — entered as either a target time or a target pace and stored
// as a single canonical finish time. Saving goes through the saveRacePlan server
// action followed by router.refresh() so every force-dynamic page re-anchors.
export function RaceDateDialog({
  open,
  onClose,
  currentDateValue,
  currentName,
  currentDistanceKm,
  currentGoalTimeSeconds,
}: {
  open: boolean;
  onClose: () => void;
  /** The race date currently driving the plan, as a date-input value. */
  currentDateValue: string;
  /** The race name currently shown, prefilled as a starting point. */
  currentName: string;
  /** The stored race distance (km), or null — prefills the distance picker. */
  currentDistanceKm: number | null;
  /** The stored goal finish time (seconds), or null — prefills the goal field. */
  currentGoalTimeSeconds: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dateValue, setDateValue] = useState(currentDateValue);
  const [name, setName] = useState(currentName);
  const [distancePreset, setDistancePreset] = useState<DistancePresetId>(
    presetForKm(currentDistanceKm)
  );
  const [customKm, setCustomKm] = useState(
    currentDistanceKm != null ? String(currentDistanceKm) : ""
  );
  const [goalMode, setGoalMode] = useState<GoalMode>(
    currentGoalTimeSeconds != null ? "time" : "none"
  );
  const [goalValue, setGoalValue] = useState(
    currentGoalTimeSeconds != null ? formatClock(currentGoalTimeSeconds) : ""
  );
  const [error, setError] = useState<string | null>(null);

  // Re-seed the fields each time the dialog opens with what the page shows now.
  useEffect(() => {
    if (open) {
      setDateValue(currentDateValue);
      setName(currentName);
      setDistancePreset(presetForKm(currentDistanceKm));
      setCustomKm(currentDistanceKm != null ? String(currentDistanceKm) : "");
      setGoalMode(currentGoalTimeSeconds != null ? "time" : "none");
      setGoalValue(currentGoalTimeSeconds != null ? formatClock(currentGoalTimeSeconds) : "");
      setError(null);
    }
  }, [open, currentDateValue, currentName, currentDistanceKm, currentGoalTimeSeconds]);

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

  // The other side of the goal: enter a time, see the pace it implies (and vice
  // versa), so the user can sanity-check what they typed against their distance.
  const goalDerived = useMemo(() => {
    if (goalMode === "none") return null;
    const distanceKm = resolveDistanceKm(distancePreset, customKm);
    const parsed = parseClock(goalValue);
    if (distanceKm === null || distanceKm <= 0 || parsed === null) return null;
    if (goalMode === "time") return `≈ ${formatPaceSeconds(parsed / distanceKm)} /km`;
    return `≈ ${formatClock(parsed * distanceKm)}`;
  }, [goalMode, goalValue, distancePreset, customKm]);

  if (!open) return null;

  const submit = () => {
    setError(null);

    const distanceKm = resolveDistanceKm(distancePreset, customKm);
    if (distanceKm === null || distanceKm < 1 || distanceKm > 100) {
      setError("Vælg en gyldig distance (1–100 km).");
      return;
    }

    let goalTimeSeconds: number | null = null;
    if (goalMode !== "none") {
      const parsed = parseClock(goalValue);
      if (parsed === null) {
        setError(
          goalMode === "time"
            ? "Ugyldig måltid — skriv fx 1:45:00 eller 48:30."
            : "Ugyldig målpace — skriv fx 5:00."
        );
        return;
      }
      goalTimeSeconds = goalMode === "pace" ? Math.round(parsed * distanceKm) : parsed;
      if (goalTimeSeconds < 60 || goalTimeSeconds > 86_400) {
        setError("Målet ligger uden for et realistisk interval.");
        return;
      }
    }

    startTransition(async () => {
      const result = await saveRacePlan({
        raceDate: dateValue,
        raceName: name.trim() ? name.trim() : undefined,
        raceDistanceKm: distanceKm,
        goalTimeSeconds,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // saveRacePlan is a Server Action, so track() runs here on the client
      // instead. Anonymous — the date, name, distance and goal are never sent.
      track("racedato_sat");
      if (goalTimeSeconds !== null) track("racemaal_sat");
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
        className="relative max-h-[90vh] w-full max-w-[420px] overflow-y-auto px-[26px] py-[24px] [animation:cg-fade-up_0.3s_ease_both] motion-reduce:[animation:none]"
      >
        <span className="cg-label tracking-[0.18em] text-red">Din race</span>
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
            <span className="cg-label">Race-dato</span>
            <input
              type="date"
              required
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="cg-interactive rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 font-cg-mono text-[13px] text-cobalt outline-none focus:border-cobalt"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="cg-label">Racenavn (valgfrit)</span>
            <input
              type="text"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Silkeborg Halvmarathon"
              className="cg-interactive rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 text-[13.5px] text-cobalt outline-none placeholder:text-ink/50 focus:border-cobalt"
            />
          </label>

          <fieldset className="flex flex-col gap-1.5 border-0 p-0">
            <legend className="cg-label mb-1.5 p-0">Distance</legend>
            <div className="flex flex-wrap gap-2">
              {DISTANCE_PRESETS.map((preset) => {
                const active = distancePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDistancePreset(preset.id)}
                    className={`cg-interactive rounded-pill border px-[14px] py-[7px] cg-label text-[11px] tracking-[0.1em] transition-colors ${
                      active
                        ? "border-cobalt bg-cobalt text-silver"
                        : "border-cobalt/30 text-cobalt hover:bg-cobalt/8"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {distancePreset === "custom" ? (
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  step="0.1"
                  inputMode="decimal"
                  value={customKm}
                  onChange={(event) => setCustomKm(event.target.value)}
                  placeholder="fx 30"
                  className="cg-interactive w-[120px] rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 font-cg-mono text-[13px] text-cobalt outline-none placeholder:text-ink/50 focus:border-cobalt"
                />
                <span className="cg-label text-ink">km</span>
              </label>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5 border-0 p-0">
            <legend className="cg-label mb-1.5 p-0">Mål (valgfrit)</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "none", label: "Intet mål" },
                  { id: "time", label: "Måltid" },
                  { id: "pace", label: "Målpace" },
                ] as const
              ).map((option) => {
                const active = goalMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setGoalMode(option.id)}
                    className={`cg-interactive rounded-pill border px-[14px] py-[7px] cg-label text-[11px] tracking-[0.1em] transition-colors ${
                      active
                        ? "border-cobalt bg-cobalt text-silver"
                        : "border-cobalt/30 text-cobalt hover:bg-cobalt/8"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {goalMode !== "none" ? (
              <label className="mt-2 flex flex-col gap-1.5">
                <span className="cg-label-sm text-ink">
                  {goalMode === "time" ? "Sluttid (t:mm:ss)" : "Pace (m:ss /km)"}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={goalValue}
                  onChange={(event) => setGoalValue(event.target.value)}
                  placeholder={goalMode === "time" ? "1:45:00" : "5:00"}
                  className="cg-interactive w-[160px] rounded-pill border border-cobalt/30 bg-white/60 px-4 py-2 font-cg-mono text-[13px] text-cobalt outline-none placeholder:text-ink/50 focus:border-cobalt"
                />
                {goalDerived ? (
                  <span className="cg-label-sm font-cg-mono text-cobalt">{goalDerived}</span>
                ) : null}
              </label>
            ) : null}
          </fieldset>

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
              <span className="font-semibold text-cobalt">{phaseShift.to}</span> — ugens anbefaling
              ændrer sig.
            </p>
          ) : null}

          {error ? <p className="m-0 text-[12px] leading-snug text-red">{error}</p> : null}

          <div className="mt-1 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="cg-interactive rounded-pill px-[18px] py-[7px] cg-label text-[11px] tracking-[0.12em] transition-colors hover:bg-cobalt/8"
            >
              Annullér
            </button>
            <button
              type="submit"
              disabled={pending}
              className="cg-interactive rounded-pill bg-cobalt px-[18px] py-[7px] cg-label text-[11px] tracking-[0.12em] text-silver transition-opacity disabled:opacity-60"
            >
              {pending ? "Gemmer…" : "Gem race"}
            </button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
