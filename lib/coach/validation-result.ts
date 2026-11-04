import type { ValidationIssue, ValidationResult } from "./types";

// ── Client serialization ──────────────────────────────────────────────────────

/**
 * A `ValidationResult` flattened for the client boundary (plain JSON, no
 * `undefined` gaps across a server→client prop) with a ready-to-render
 * `summary` line added.
 */
export interface SerializedValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  /** One-line Danish headline for the UI. */
  summary: string;
}

function summarizeValidation(result: ValidationResult): string {
  if (!result.valid) {
    const n = result.issues.length;
    return `${n} blokerende ${n === 1 ? "problem" : "problemer"}`;
  }
  if (result.warnings.length > 0) {
    const n = result.warnings.length;
    return `Godkendt med ${n} ${n === 1 ? "advarsel" : "advarsler"}`;
  }
  return "Godkendt";
}

/** Flatten a `ValidationResult` into a plain, JSON-safe shape for the client. */
export function serializeValidationResult(result: ValidationResult): SerializedValidationResult {
  return {
    valid: result.valid,
    issues: result.issues,
    warnings: result.warnings,
    summary: summarizeValidation(result),
  };
}
