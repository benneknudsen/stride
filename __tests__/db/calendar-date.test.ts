import { describe, expect, it } from "vitest";

import { fromDbDate, toDbDate } from "@/lib/db/calendar-date";

/**
 * Regression tests for issue #102 — the race date landed in the DB one day
 * early outside UTC.
 *
 * These drive the *real* Drizzle round-trip rather than the helpers in
 * isolation: `PgDate.mapToDriverValue` is `value.toISOString()`, Postgres casts
 * that timestamp text to a `date` by taking its leading YYYY-MM-DD, and
 * `PgDate.mapFromDriverValue` is `new Date(text)` (which JS reads as UTC
 * midnight). Reproducing all three steps is what makes the test fail on the old
 * code in a UTC+N zone; asserting on the helpers alone would not.
 *
 * The suite is timezone-sensitive by design. It passes in UTC either way, so
 * run it under a non-UTC zone to get the coverage:
 *
 *   TZ=Europe/Copenhagen npx vitest run __tests__/db/calendar-date.test.ts
 *   TZ=America/New_York  npx vitest run __tests__/db/calendar-date.test.ts
 */

/** Postgres storing a `date`: the driver text, truncated to its calendar day. */
function storeAsPgDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Drizzle handing a `date({ mode: "date" })` column back to the app. */
function loadFromPgDate(text: string): Date {
  return new Date(text);
}

/** The app's calendar-day convention: a Date at *local* midnight. */
function localDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

const DAYS = [
  ["the issue's example", 2026, 5, 10],
  ["a DST spring-forward day", 2026, 3, 29],
  ["a DST fall-back day", 2026, 10, 25],
  ["a leap day", 2028, 2, 29],
  ["new year's day", 2027, 1, 1],
  ["new year's eve", 2026, 12, 31],
] as const;

describe("race date round-trip through a Drizzle date column", () => {
  it.each(DAYS)("preserves the calendar day: %s", (_label, year, month, day) => {
    const picked = localDay(year, month, day);

    const stored = storeAsPgDate(toDbDate(picked));
    const loaded = fromDbDate(loadFromPgDate(stored));

    // The day the user picked is the day Postgres holds...
    expect(stored).toBe(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    );
    // ...and the day that comes back, read through the local getters the engine
    // and view-models use (buildPhases, dateInputValue, the plan labels).
    expect([loaded.getFullYear(), loaded.getMonth() + 1, loaded.getDate()]).toEqual([
      year,
      month,
      day,
    ]);
    expect(loaded.getTime()).toBe(picked.getTime());
  });

  it("stores the picked day, not the offset-shifted one (the #102 bug)", () => {
    const tenthOfMay = localDay(2026, 5, 10);

    // The old code passed the local-midnight Date straight to Drizzle. In any
    // UTC+N zone that serialises to the previous day — this is the bug.
    const broken = storeAsPgDate(tenthOfMay);
    const fixed = storeAsPgDate(toDbDate(tenthOfMay));

    expect(fixed).toBe("2026-05-10");
    if (tenthOfMay.getTimezoneOffset() < 0) {
      // UTC+N (e.g. Europe/Copenhagen): the old path is off by a day.
      expect(broken).toBe("2026-05-09");
    }
  });

  it("passes null through in both directions (no race chosen)", () => {
    expect(toDbDate(null)).toBeNull();
    expect(fromDbDate(null)).toBeNull();
  });
});
