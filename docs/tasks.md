# Implementation Tasks

Each task is a self-contained prompt for Claude Code. Do them in order.

> **SUPERSEDED IN PART (issue #292).** The model-led half of this plan was
> withdrawn: Strava's API Policy 2026 §5.3 forbids using Strava data — including
> derived, anonymised or aggregated data — in any AI application, explicitly
> including "ingestion into a context window or working memory"; §5.10 forbids
> passing it to AI providers; and §5.16(b) forbids MCP/agent-mediated interfaces
> that expose it. So the LLM layer was **deleted**, not gated behind a key, and
> it must not be rebuilt — no OpenRouter / `ai` SDK / embeddings / local-ML
> substitute either. Tasks 1–7 and 9–11 below are historical but harmless: they
> describe the deterministic parts of Stride that were built as written. **Task 8
> ("AI analysis — generative UI") and the "Phase 2: RAG chatbot" line are
> withdrawn** and must not be built — both are marked inline. Everything that
> replaced them is the deterministic engine: `heuristicBlocks` in
> `lib/ai/analysis.ts`, the block contract in `lib/ai/tools.ts`, `lib/coach/*`
> and `lib/training/*`.

## Foundation

### 1. Scaffold project
```
claude -p "Scaffold a Next.js 16 project with TypeScript strict, Tailwind, shadcn/ui, and Biome. Follow CLAUDE.md conventions."
```
- Next.js 16 with App Router, TypeScript strict
- Tailwind CSS + shadcn/ui (new-york, zinc, neutral)
- Biome for linting/formatting
- `.env.example` skeleton

### 2. Database schema + Drizzle setup
- Create `drizzle/schema.ts` from ARCHITECTURE.md §2
- `drizzle/relations.ts`
- Drizzle config for Vercel Postgres
- `lib/db/index.ts` + `lib/db/queries.ts`
- Generate initial migration

### 3. Auth + crypto foundation
- NextAuth v5 with database sessions
- `lib/crypto.ts` (AES-256-GCM encrypt/decrypt)
- `lib/auth.ts` (auth, handlers, session helpers)
- `middleware.ts` (auth gate on (app) routes)
- Types in `types/domain.ts`

## Core Features

### 4. Strava OAuth + token management
- `lib/strava/oauth.ts` (PKCE flow, token exchange)
- `lib/strava/client.ts` (fetch wrapper, auto-refresh)
- `/api/auth/[...nextauth]/route.ts` with Strava provider
- Encrypted token storage in `strava_tokens`
- "Connect Strava" button → dashboard redirect

### 5. Strava sync pipeline
- `lib/strava/mappers.ts` (Strava DTO → domain model)
- `lib/strava/types.ts` (Strava API response types)
- `/api/strava/sync/route.ts` (backfill 30 activities)
- `/api/strava/webhook/route.ts` (edge, verify + enqueue)
- `actions/activities.ts` (refreshActivities, getActivity)

### 6. Dashboard page
- Server Component shell + Suspense boundaries
- `stats-header.tsx` (weekly volume, avg pace, total distance)
- `weekly-volume-chart.tsx` (Recharts, last 12 weeks)
- `pace-distribution-chart.tsx` (Recharts)
- `activity-list.tsx` + `activity-row.tsx`
- `filters-bar.tsx` (Zustand for date range, type)

### 7. Activity detail page
- `app/(app)/dashboard/activity/[id]/page.tsx`
- `activity-map.tsx` (polyline render)
- `splits-table.tsx`
- `hr-zones-chart.tsx`
- Ownership guard (userId check server-side)

### 8. AI analysis — generative UI

> **WITHDRAWN (issue #292) — do not build.** The list below is the original
> plan, kept for history only. None of it may be implemented as written:
> `lib/ai/provider.ts` and `lib/ai/prompts.ts` are deleted, and no
> `streamUI`/model call may be reintroduced. What actually exists today:
> `/api/ai/analyze` is a deterministic NDJSON block stream — it reduces the
> athlete's activities with `buildAnalysisInput` and emits typed blocks from
> `heuristicBlocks` in `lib/ai/analysis.ts`, validated against
> `analysisBlockSchema` from `lib/ai/tools.ts`. There is no provider, no cache
> and no `actions/analysis.ts` cache path; `inputHash` deduplication is gone
> with the `ai_analyses` table. The insights are arithmetic over the athlete's
> own numbers, not generated text.

Historical plan:
- `lib/ai/provider.ts` (provider router)
- `lib/ai/tools.ts` (insight-card, trend-callout, workout-recommendation, metric-comparison)
- `lib/ai/prompts.ts` (system prompt templates)
- `/api/ai/analyze/route.ts` (streamUI endpoint)
- `analysis-panel.tsx` (client orchestrator)
- `streaming-text.tsx`
- `actions/analysis.ts` (requestAnalysis, getCachedAnalysis)
- AI result caching via `inputHash`

## Polish

### 9. Demo mode
- `lib/demo/data.ts` (30 realistic running activities)
- Seed logic: trigger on first visit if no Strava connected
- Works end-to-end without OAuth

### 10. Error, empty, loading states
- Every page: loading skeleton, error boundary, empty state
- "No Strava connected" CTA
- Analysis: block-stream skeleton, error fallback (no cached result — the `ai_analyses` cache was dropped in `drizzle/migrations/0009_*`)

### 11. Deploy + README
- Vercel deployment
- Environment variables configured
- README.md with architecture overview, demo link, tech decisions
- "Dev workflow" section explaining Claude Code + Hermes orchestrator (was framed as "AI-first workflow" before #292; the README no longer makes AI claims, so don't restore that framing)

## Phase 2
- ~~RAG chatbot (`/api/ai/chat`, pgvector, `activity_embeddings`)~~ — **permanently
  dropped (issue #292), not deferred.** Strava's API Policy 2026 §5.3 forbids Strava
  data — derived data included — in any AI application, and §5.16(b) forbids
  MCP/agent-mediated interfaces exposing it, so chat/RAG/pgvector/embeddings can
  never ship. Do not open this as backlog again. (`/api/ai/chat`, `chat_messages`
  and `activity_embeddings` are deleted; `lib/ai/analysis.ts` and `lib/coach/*`
  replace the intended coaching surface.)
- Training suggestions — **done** (`/plan` phase-aware suggestions from
  `getPlanSuggestions` in `lib/cobalt/plan.ts`, with readiness and the recovery
  buffer applied by the engine)
- Performance benchmarking (Lighthouse 95+)
- Vitest + Playwright test suite — **done** (59 Vitest files, 4 Playwright specs in
  `__tests__/e2e/`; `npm test` and `npm run test:e2e`)

> **Hermes: read `docs/handoff-2026-07-07-coach-review.md` before planning the
> next tasks.** It contains the 2026-07-07 coach/AI review outcome (4 bugs
> fixed in commit `13ab63b`), the remaining findings backlog (B1–B10), and a
> recorded product decision: sleep data is removed and must not be reintroduced.
> Its T1–T5 "live AI coach chat" roadmap was superseded by issue #292 — RAG and
> the chat route are permanently dropped, not deferred, so do not resurrect T1 or
> anything downstream of it. The engine findings (B1–B10) and the
> accounts/env/domain items still stand.

---

## How to use

For each task, I (Hermes) will:
1. Read the task
2. Craft a precise prompt for Claude Code
3. Run `claude -p "..."` in print mode
4. Verify the output
5. Report to Benjamin
6. Git commit the result
