// Stride — pure slot and gate steps for the workout recommender (issue #347).
// Each step answers one question about today and returns a small, named value:
//
//   resolveSlot  → which slot does the phase week plan give today?
//   applyGates   → which gate wins, and what does the card say?
//
// The state read lives in risk.ts; the distance assembly in distance.ts.
// The orchestration in recommender.ts only calls these in order and assembles
// the card. Pure and deterministic: the clock and the athlete state are inputs.

import type { PhaseKey, PhaseRules, PlannedSession } from "@/lib/coach/engine";
import {
  INJURY_RECOVERY_HOURS,
  type RunType,
  readinessRestReason,
  round1,
  type StateAssessment,
} from "@/lib/coach/recommender/risk";
import { dayShapeReason } from "@/lib/coach/run-character";

// ── Step 1 — slot ───────────────────────────────────────────────────────────

export interface SlotInput {
  today: Date;
  phase: PhaseKey;
  rules: PhaseRules;
  weekPlan: readonly PlannedSession[];
}

export interface SlotDecision {
  /** 0 = Monday … 6 = Sunday. */
  dayOfWeek: number;
  slot: PlannedSession;
  /** The plan says rest — a preference the state gates may overrule (#332). */
  restSlot: boolean;
  /** The deliberate exception: a taper rest day is part of race-week shape. */
  isTaperRest: boolean;
  /** The slot's run type, before any state gate softens it. */
  type: RunType;
}

/**
 * Step 1: the phase week plan decides the day's slot (rest / easy / tempo /
 * long). A rest slot stays a preference here; a taper rest is the exception the
 * gates must honour as a command.
 */
export function resolveSlot(input: SlotInput): SlotDecision {
  const dayOfWeek = (input.today.getDay() + 6) % 7;
  const slot = input.weekPlan[dayOfWeek];
  const restSlot = slot.type === "rest";
  const type: RunType =
    slot.type === "long"
      ? "long"
      : slot.type === "tempo" && input.rules.hasTempoSession
        ? "tempo"
        : "easy";
  return {
    dayOfWeek,
    slot,
    restSlot,
    isTaperRest: restSlot && input.phase === "taper",
    type,
  };
}

// ── Step 2 — gates ──────────────────────────────────────────────────────────

/** The gate that turned the day into rest, or none when a run stands. */
export type RestGate = "taper-rest" | "recovery" | "load-risk" | "readiness" | "week-budget";

export type GateOutcome =
  | { kind: "rest"; gate: RestGate; reason: string[]; recoveryHours: number }
  | { kind: "run"; gate: null; type: RunType; reason: string[] };

export interface GateInput {
  phase: PhaseKey;
  slot: SlotDecision;
  state: StateAssessment;
  injuryHistory: boolean;
}

/**
 * Step 2: apply the gates in their documented order and return which one won.
 * Rest gates stop the day; softening gates (elevated risk, football, readiness
 * easy, last-run shape) only change a run that the safety rules already allowed.
 * The shape read is the same `dayShapeGate` the variation card calls (see
 * `run-character.ts`), so both cards explain the same state the same way.
 */
export function applyGates(input: GateInput): GateOutcome {
  const { phase, slot, state } = input;

  // Taper rest is a command, not a preference.
  if (slot.isTaperRest) {
    const reason = [
      `Planlagt hviledag i ${phase}-fasen — nedtrapningen er bevidst, og restitution er en del af planen.`,
    ];
    if (state.highRiskReason) reason.push(state.highRiskReason);
    return { kind: "rest", gate: "taper-rest", reason, recoveryHours: state.recoveryHours };
  }

  // Recovery buffer — 48 h before a hard session, 24 h before easy/long,
  // 72 h with an injury history. Broken buffer always wins over the slot.
  if (state.gapHours < state.recoveryHours) {
    const { gapHours: gap, recoveryHours, slotType: type } = state;
    const reason: string[] = [];
    // Even when the buffer is the proximate cause, the high-risk read belongs
    // on the card: the rest is not only about elapsed time.
    if (state.highRiskReason) reason.push(state.highRiskReason);
    if (input.injuryHistory) {
      reason.push(
        `Skadehistorik: kroppen får ${INJURY_RECOVERY_HOURS} timer mellem løbeture — kun ${Math.round(gap)} timer siden sidste tur.`
      );
    } else {
      reason.push(
        `Kun ${Math.round(gap)} timer siden sidste løbetur — under ${recoveryHours}-timers restitutionsbufferen før ${type === "tempo" ? "et hårdt pas" : "en rolig tur"}.`
      );
    }
    return { kind: "rest", gate: "recovery", reason, recoveryHours };
  }

  // High risk always wins over the slot, exactly like a broken recovery buffer.
  if (state.highRiskReason) {
    return {
      kind: "rest",
      gate: "load-risk",
      reason: [state.highRiskReason],
      recoveryHours: state.recoveryHours,
    };
  }

  // Readiness rest band: the body needs restitution, no run today.
  if (state.readiness.band === "rest") {
    return {
      kind: "rest",
      gate: "readiness",
      reason: [readinessRestReason(state.readiness)],
      recoveryHours: state.recoveryHours,
    };
  }

  // The week has already used its prorated volume budget.
  const { weekToDateKm, proratedWeeklyKm, weekBudgetKm } = state.week;
  if (state.week.weekLoadKnown && weekToDateKm !== null && weekToDateKm >= weekBudgetKm) {
    return {
      kind: "rest",
      gate: "week-budget",
      reason: [
        `Du har allerede løbet ${round1(weekToDateKm)} km i denne uge — ugens planlagte volumen i ${phase}-fasen er ${round1(proratedWeeklyKm)} km indtil i dag, så i dag er en hviledag.`,
      ],
      recoveryHours: state.recoveryHours,
    };
  }

  let type = state.type;
  if (state.dayShape && (type === "tempo" || type === "long")) type = "easy";

  const reason: string[] = [];
  if (state.elevatedReason) reason.push(state.elevatedReason);
  if (state.footballReason) reason.push(state.footballReason);
  reason.push(state.readinessReason);
  if (state.dayShape && !(state.dayShape === "pause" && state.longPause)) {
    reason.push(dayShapeReason(state.dayShape, state.gapHours));
  }
  if (slot.restSlot) {
    reason.push(
      `Ugens hviledag i ${phase}-fasen var en præference — tilstanden tillader en rolig tur, så dagen bliver et let pas i planens bånd.`
    );
  }

  return { kind: "run", gate: null, type, reason };
}
