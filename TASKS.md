# Implementation Tasks

Each task is a self-contained prompt for Claude Code. Do them in order.

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
- AI analysis: streaming skeleton, error fallback, cached result display

### 11. Deploy + README
- Vercel deployment
- Environment variables configured
- README.md with architecture overview, demo link, tech decisions
- "AI-first workflow" section explaining Claude Code + Hermes orchestrator

## Phase 2 (future)
- RAG chatbot (`/api/ai/chat`, pgvector, `activity_embeddings`)
- Training suggestions
- Performance benchmarking (Lighthouse 95+)
- Vitest + Playwright test suite

---

## How to use

For each task, I (Hermes) will:
1. Read the task
2. Craft a precise prompt for Claude Code
3. Run `claude -p "..."` in print mode
4. Verify the output
5. Report to Benjamin
6. Git commit the result
