# Handoff: Coach/AI code review + fixes → next phase (AI coach chat)

**To:** Hermes (orchestrator)
**From:** Claude Code review session, 2026-07-07
**Branch:** `claude/workout-ai-coach-review-6ud5v7` (commit `13ab63b`)
**Purpose:** Everything you need to (a) understand what changed and why, (b) turn
the remaining findings and the agreed roadmap into tasks, in the right order.

---

## 1. What this session did (already committed — do not re-task)

A full review of the coach/AI logic chain (`lib/coach/engine.ts`, `lib/coach/
recommender.ts`, `lib/training/progression.ts`, `lib/ai/*`, `/api/ai/analyze`,
Strava webhook/sync, dashboard builders) found 4 real bugs. All 4 are fixed in
commit `13ab63b`:

1. **Recovery/plan conflict (time bomb, would have fired 3 Aug 2026).** The
   5-session sharpen/peak week violated the engine's own 48 h recovery rule,
   so the recommender would have forced rest on planned days and the mid-week
   tempo could never fire. Fix: recovery is now slot-aware — 48 h before
   quality work (`MIN_RECOVERY_HOURS`), 24 h before easy/long runs
   (`EASY_MIN_RECOVERY_HOURS`, new), 72 h with injury history. The 5-day week
   layout moved to mon/wed/fri/sat/sun. The `recovery-48h` constraint id was
   renamed to `recovery-window`. A new engine test validates every generated
   week (incl. the sun→mon wrap) against its own constraint set.
2. **`getCurrentProgression` fetch window.** It fetched exactly 28 days, so
   `hasFullWindow` could never become true against live data and every user
   would be treated as a beginner. Fix: fetch reaches one extra window back.
3. **Cache revalidation was never wired.** The `"progression"` tag on the 1 h
   chart cache had no `revalidateTag` caller anywhere. Fix: webhook
   (create/update/delete) and sync route now call a shared
   `revalidateProgression()` helper (`lib/coach/dashboard-data.ts`). Note:
   Next 16 changed the `revalidateTag` signature — it now requires a cache
   profile; we use `{ expire: 0 }` for legacy hard-expire behaviour.
4. **Webhook delete was not user-scoped.** Now filters on
   `(userId, stravaActivityId)`, matching the unique key.

**Product decision (Benjamin, 2026-07-07): sleep data is removed entirely and
must not be reintroduced.** Gone: `sleepQuality` on `WorkoutInput`/
`WorkoutContext`, the poor-sleep constraint, the pace/HR sleep adjustments,
`ValidationResult.hrAdjustmentBpm`/`paceAdjustment`, and all related tests.
If a future issue mentions sleep-based coaching, flag it to Benjamin instead
of implementing.

Verification: 484/484 tests green, `tsc` clean, production build green
(build needs any `POSTGRES_URL` set; lint warnings that remain are
pre-existing in untouched files).

## 2. Review findings NOT yet fixed (backlog candidates)

Ordered by suggested priority. Each is small unless noted.

| # | Finding | Where | Notes |
|---|---------|-------|-------|
| B1 | No rate limiting on `/api/ai/analyze` (and any future AI route) | `app/api/ai/analyze/route.ts` | `lib/rate-limit.ts` exists but is in-memory → per-instance on Vercel. For token-burning routes use a durable store (Upstash/Redis) or accept the per-instance limit consciously. Must land before the app is shared publicly with an AI key set. |
| B2 | Recommender ignores `trainingLoad.risk` | `lib/coach/recommender.ts` | `elevated`/`high` acute:chronic ratio changes nothing today; only `optimal` is used (via `readyToIncrease`). High risk should at minimum block tempo and/or shorten distance. `zone2Percent` is computed but unused too. |
| B3 | `recommendWorkout` never runs `validateWorkout` | `lib/coach/recommender.ts` | The constraint engine is not applied to its own recommendation (e.g. the 10% weekly-progression rule). Running the card through validation would catch future rule conflicts automatically and give free UI warnings. |
| B4 | No taper/race week | `lib/coach/engine.ts` | Peak ends 14 Sep, race is 20 Sep; `getCurrentPhase` holds at peak, so race week would get tempo + 18 km long run. Needs a 5th `taper` phase or race-week special case. |
| B5 | Workout card vs week strip distance mismatch | `recommender.ts` + `engine.ts` | Strip shows tempo at `maxDistanceKm`, card gives `minDistanceKm` unless `readyForMore` — same day can show two distances. Decide one source. |
| B6 | `readyForMore` doesn't check what it claims | `recommender.ts` step 5 | Comment/reason promise "improved/stable pace efficiency"; code only checks `paceEfficiency !== null`. The snapshot series has the data for a real week-over-week comparison. |
| B7 | Sync route doesn't scale | `app/api/strava/sync/route.ts` | One `getActivity` detail call per activity, serial → hits Strava rate limit (~100 reads/15 min) and serverless timeout on large histories; no `maxDuration`; no advisory lock (can race the webhook). Consider summary-only first sync + details via webhook/on-demand. Medium size. |
| B8 | Hardcoded load status in Cobalt coach view | `lib/cobalt/coach.ts` | `status: "OPTIMAL"` + trend note are hardcoded while bars/gauge are derived — can contradict the dashboard. Derive from the same acute:chronic ratio. |
| B9 | `CoachFeed` fetch lifecycle | `components/cobalt/coach-dashboard/CoachFeed.tsx` | No `AbortController` on unmount; `startedRef` guard means a changed `activities` prop never refetches (fine for demo, a trap with live data). |
| B10 | Minor | various | `buildWeekStrip` marks today as "next" even after the run is done; webhook `recovery` uses `Math.abs`; half-marathon estimate in `lib/cobalt/coach.ts` is linear (Riegel `t2 = t1 × (d2/d1)^1.06` is better). |

## 3. Current state of the AI coach chat (important context)

The chat on `/coach` (`ChatPanel.tsx`) is **100% scripted demo theatre**: it
cycles 3 canned replies from `lib/cobalt/coach.ts` behind a 1.4 s fake typing
timer, and the page's loading overlay is a plain 2 s `setTimeout`. There is no
`/api/ai/chat` route. Nothing the user types ever reaches a model.

What already exists and should be REUSED, not rebuilt:

- `lib/ai/provider.ts` — gateway router (primary/fallback models,
  `isAIConfigured()`), server-only. Ready to be called from a chat route.
- The domain engine as agent tools: `recommendWorkout()`, `validateWorkout()`,
  `computeSnapshot()`/`getProgression()`, `getWeekPlan()` are pure,
  JSON-friendly, and `engine.ts` explicitly describes itself as "the constraint
  set the AI coach must respect". The agent should CALL these as tools, not
  have the model guess training advice.
- `/api/ai/analyze/route.ts` is the template for the chat route: zod-validated
  request, auth gate when a key is set, streaming, provider fallback,
  deterministic no-key fallback. Chat is the same skeleton with `streamText` +
  tools instead of `streamObject`.
- The scripted replies remain the sensible no-key demo fallback.
- Architecture docs already plan `/api/ai/chat`, `chat_messages`, and Phase 2
  RAG (`activity_embeddings`, pgvector). **Recommendation: skip RAG for now** —
  a 4-week snapshot + ~30 recent runs fits directly in the prompt; revisit
  embeddings only when history reaches hundreds of runs.

## 4. Agreed roadmap (Benjamin approved this order, 2026-07-07)

### Benjamin's tasks (accounts/env — not Claude Code work)

1. **Deploy + DB:** Vercel project + Postgres → `DATABASE_URL`, run
   `npm run db:migrate`, set `AUTH_SECRET` (32 B base64) and `ENCRYPTION_KEY`
   (32-byte hex). Demo mode is fully functional at this point.
2. **Auth env:** Google Cloud OAuth client → `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`.
   Auth code already exists (Google + magic link + dev/dev in dev). Magic links
   wait on a domain (Resend sender verification for `noreply@stride.run`).
3. **Strava:** create API app (callback domain may be the vercel.app domain) →
   `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` (exact
   match), `STRAVA_VERIFY_TOKEN` (self-chosen). Connect account, run
   `/api/strava/sync`, register the webhook subscription (one curl).
4. **AI key:** `AI_GATEWAY_API_KEY` (Vercel AI Gateway). Analyze/coach-feed
   switch from heuristic to real model with zero code changes.
5. **Domain:** optional, any time; only blocks magic-link email + branding.

### Claude Code tasks (for you to prompt, in order)

**T1 — AI coach chat route + agent tools.** New `/api/ai/chat`: `streamText`
with a running-coach system prompt (Danish output), grounded in the user's
progression snapshot + week plan + recent activities, exposing
`recommendWorkout`/`validateWorkout`/`getProgression`/`getWeekPlan` as tools.
Auth-gated when AI is configured; deterministic scripted fallback without a
key (mirror the analyze route's structure). Include rate limiting from day one
(see B1). Acceptance: a question like "skal jeg løbe i dag?" gets a streamed
answer whose recommendation matches `recommendWorkout()` output for the same
inputs; without an AI key the route still answers deterministically.

**T2 — ChatPanel goes live.** Replace the canned-reply logic in
`ChatPanel.tsx` with streaming against `/api/ai/chat` (AI SDK `useChat` or the
manual NDJSON pattern `CoachFeed.tsx` already uses). Keep the existing UI
(bubbles, typing indicator, prompt chips). Remove `CoachView.replies` and the
fake 2 s loading overlay. Add error/retry state, `AbortController` on unmount.

**T3 — Chat persistence.** `chat_messages` table (planned in
`docs/architecture.md` §DB), Drizzle migration, load history on page open,
save turns in the route. Cap context (e.g. last N messages) before prompting.

**T4 — Coach page on real data.** Convert `app/(app)/coach/page.tsx` from a
client component importing demo fixtures to a Server Component that fetches
the signed-in user's data (falling back to demo fixtures when unauthenticated),
passing it down. Derive the right-column cards (focus quote, form status, load
status) from the same engine the chat uses — fixes B8 in passing.

**T5 — Backlog sweep.** B1–B7 from §2 as individual small tasks (B1 first if
not already done inside T1).

## 5. Conventions to hold Claude Code to

- Engine stays the single source of truth: chat/recommender modules decide,
  `lib/coach/engine.ts` defines rules. No rule duplication in prompts.
- Pure functions with the clock as a parameter; tests pin dates.
- AI keys never reach the browser; all model calls under `/api/ai/*`.
- User-facing coach text is Danish; code/comments/docs English.
- No sleep data (see §1 product decision).
- `npm test` + `npx tsc --noEmit` green before commit; note that
  `npm run build` needs a dummy `POSTGRES_URL` in this environment.
