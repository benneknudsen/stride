/**
 * The `date` ↔ `Date` boundary for day-granular Postgres columns (issue #102).
 *
 * The app represents a calendar day as a Date at *local* midnight — that is what
 * `getLocalDate()` returns, what `buildPhases()` reads with `getFullYear()` /
 * `getMonth()` / `getDate()`, and what the race dialog builds from its
 * `<input type="date">` value. Drizzle's `date({ mode: "date" })` uses the *UTC*
 * midnight convention on both sides:
 *
 *   - write: `mapToDriverValue` is `value.toISOString()`, so a local-midnight
 *     Date in a UTC+N zone serialises to the *previous* day (10 May 00:00 in
 *     Europe/Copenhagen → "2026-05-09T22:00:00.000Z" → Postgres stores 9 May).
 *   - read: Drizzle overrides the driver's DATE parser to hand back the raw
 *     "YYYY-MM-DD" text, then does `new Date(value)` — which JS parses as UTC
 *     midnight, so the local getters used downstream read the previous day in
 *     any UTC-N zone.
 *
 * Vercel runs in UTC, where both conventions coincide and nothing breaks — which
 * is exactly why this stayed hidden. Converting here keeps the timezone
 * dependency in one place instead of leaking it into every caller.
 */

/** A local-midnight calendar day → the UTC-midnight Date Drizzle serialises correctly. */
export function toDbDate(day: Date): Date;
export function toDbDate(day: null): null;
export function toDbDate(day: Date | null): Date | null;
export function toDbDate(day: Date | null): Date | null {
  if (!day) return null;
  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
}

/** A UTC-midnight Date from Drizzle → the local-midnight calendar day the app uses. */
export function fromDbDate(day: Date): Date;
export function fromDbDate(day: null): null;
export function fromDbDate(day: Date | null): Date | null;
export function fromDbDate(day: Date | null): Date | null {
  if (!day) return null;
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
}
