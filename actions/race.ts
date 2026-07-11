"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { revalidateProgression } from "@/lib/coach/dashboard-data";
import { getLocalDate } from "@/lib/coach/engine";
import { updateRacePlan } from "@/lib/db/queries";

// Server action for setting the user's target race (issue #99). Same pattern
// as actions/strava.ts: the user is derived from the session — a server action
// is a callable RPC endpoint, so a client-supplied id is never trusted.

/** How far ahead a race may be planned. */
const MAX_YEARS_AHEAD = 2;

const raceInputSchema = z.object({
  /** The native date-input value, "YYYY-MM-DD" — parsed as a local calendar day. */
  raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  raceName: z.string().trim().min(1).max(80).optional(),
});

export type SaveRacePlanResult = { ok: true } | { ok: false; error: string };

/**
 * Validate and persist the user's race date + optional name, then hard-expire
 * the progression-chart cache (its content depends on the phase and therefore
 * on the race date). The four race-aware pages are all force-dynamic, so the
 * client only needs a `router.refresh()` to see the re-anchored plan.
 */
export async function saveRacePlan(input: {
  raceDate: string;
  raceName?: string;
}): Promise<SaveRacePlanResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Du skal være logget ind for at vælge en race." };

  const parsed = raceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ugyldig dato eller racenavn." };

  const [year, month, day] = parsed.data.raceDate.split("-").map(Number);
  const raceDate = new Date(year, month - 1, day);
  // A regex-valid but impossible date ("2026-02-31") rolls over in the Date
  // constructor — reject anything whose components changed.
  if (raceDate.getMonth() !== month - 1 || raceDate.getDate() !== day) {
    return { ok: false, error: "Ugyldig dato." };
  }

  // Day-granular bounds against the athlete's Danish calendar day: race day
  // itself is allowed, anything earlier is not, and 2 years is the horizon.
  const today = getLocalDate();
  if (raceDate.getTime() < today.getTime()) {
    return { ok: false, error: "Race-datoen skal være i dag eller senere." };
  }
  const horizon = new Date(
    today.getFullYear() + MAX_YEARS_AHEAD,
    today.getMonth(),
    today.getDate()
  );
  if (raceDate.getTime() > horizon.getTime()) {
    return { ok: false, error: `Race-datoen kan højst ligge ${MAX_YEARS_AHEAD} år frem.` };
  }

  await updateRacePlan(userId, { raceDate, raceName: parsed.data.raceName ?? null });
  revalidateProgression();
  return { ok: true };
}
