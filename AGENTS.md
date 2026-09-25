<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Stride — Agent Rules (AGENTS.md)

Repo: `benneknudsen/stride` — running training dashboard with a deterministic coach engine (Next.js 16 App Router).

## Stack (exact)
- Next.js 16, App Router, TypeScript strict
- Tailwind CSS + shadcn/ui (new-york style, zinc base)
- No model in the loop (#292) — the coach is a deterministic rule engine; Strava's API Policy 2026 §5.3 forbids Strava data in any AI application
- Drizzle ORM + Neon Postgres (`@neondatabase/serverless`, pooled WebSocket) — migrations in `drizzle/`, applied by `scripts/migrate.mjs`
- NextAuth.js v5 (JWT session, per-login `sid` rotation; email magic link + Google; dev Credentials in development)
- Recharts 3.x
- Vercel deployment

## Commands (verbatim from package.json)
```bash
npm run dev          # next dev on port 6969
npm run build        # node scripts/migrate.mjs && next build
npm run start        # next start
npm run check        # biome check .  (lint + format gate)
npm run lint         # biome lint .
npm run format       # biome format --write .
npm run db:generate  # drizzle-kit generate
npm run db:migrate   # drizzle-kit migrate
npm test             # vitest run
npm run test:e2e     # playwright test  (real e2e now exists — 4 .spec.ts files)
```
Linter/formatter is **Biome 2.5** (not ESLint). Config: `biome.json` — 2-space indent, 100 line width, double quotes, organizeImports on, tailwindDirectives allowed. There is no `pnpm`; use `npm` and `node_modules/.bin` directly (`export PATH="$PWD/node_modules/.bin:$PATH"`).

## Code conventions
- TypeScript strict — no `any` without explicit justification.
- Server Components by default; `'use client'` only when needed.
- Server Actions live ONLY in `actions/` — never in components.
- No AI keys exist, and no AI call may be reintroduced. User activity data is never sent to a model or any third party (Strava API Policy 2026 §5.3/§5.10/§5.16(b)).
- OAuth tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM); `ENCRYPTION_KEY` in env.
- Component files: PascalCase, one component per file (except shadcn/ui).
- Imports sorted by Biome (organizeImports). No default exports except Next.js page/layout.
- All app routes centralized in `lib/routes.ts` — never hardcode paths. `DEMO_HOME_ROUTE` (`/demo`) rewrites to the front page reading `?demo=1`; `LEGACY_COACH_ROUTE` (`/coach`) permanently redirects to `ROUTES.COACH` (`/dashboard/coach`).

## Architecture
`docs/architecture.md` is the original plan but the codebase has evolved past it — treat as historical, not authoritative.
- Drizzle over Prisma; NextAuth v5 over Clerk; no model in the loop (#292 — Strava policy compliance, and it is also cheaper and fully reproducible).
- Event-driven revalidation over ISR (running data changes on new activity only).
- **Cobalt Glass** is the standard design: `components/cobalt/` (UI) + `lib/cobalt/` (view-models, Danish: `hjem.ts`, `plan.ts`, `aktiviteter.ts`). Pages are Danish: `/` (hjem), `/aktiviteter`, `/plan`.
- Coach lives at `/dashboard/coach` only (#86); old `/coach` permanently redirects.
- Race date is per-user (#99): `actions/race.ts` + `getRacePlan`, engine demo race as fallback.
- **Plan page** (#244): no longer a Mon–Sun prescribed schedule. Surfaces 3 phase-aware run suggestions (easy/tempo/long) with distance + pace targets, from `getPlanSuggestions` in `lib/cobalt/plan.ts`. The user picks which to do today; the engine applies readiness + recovery on top.
- **Recovery buffer** (#240): the coach enforces recovery (24h before easy/long, 48h before tempo) against the actual last run — the plan page no longer prescribes rest days.
- **Readiness** (#241): asymmetric mapping in `lib/cobalt/readiness.ts` — full marks plateau at ratio 0.8–1.15, steep penalty only on the overload side, gentle decline when rested. Band thresholds: ≥80 "ready", ≥68 "easy", else "rest".
- **Race distance/goal** (#238/#239): `RaceDateDialog` lets users pick race distance (10K/Half/Marathon/custom) and goal time/pace. Goal anchors the pace grid via `mergeGoalGrid` (#242) — easy side stays grounded in prediction when no observed easy pace exists.
- Visitors (no session) get the Velkommen landing on `/` (`components/cobalt/velkommen/`); the public demo lives at `/demo`; `LandingChromeGate` hides NavBar/BottomTabBar on the landing.

## Demo mode
Live data is default (#84): authed users get their own synced activities + race plan. Demo fixtures (`lib/demo/data.ts`, 30 deterministic activities, **no `Math.random`** so SSR/hydration agree) are the fallback for signed-in users with no synced runs, and power `/demo` + landing preview widgets. View-models default to `demoActivities` and switch to live when synced runs exist (e.g. `lib/cobalt/hjem.ts:354`).

## Auth boundary (read before touching auth)
- `auth.config.ts` — shared NextAuth config; `trustHost: true` is set so self-hosted prod doesn't reject requests (Auth.js only infers this with `VERCEL`/`AUTH_URL`/`AUTH_TRUST_HOST` set). Set `AUTH_URL` to the canonical origin in prod.
- `proxy.ts` — edge middleware: sets the **per-request CSP nonce** (load-bearing security — `#89` removed `'unsafe-inline'`), enforces `trustHost` on every request, and reads the session at the edge. Because of the nonce, pages render dynamically (static caching is intentionally unavailable).

## DB access layer
- `lib/db/queries.ts` centralizes user-owned reads (consolidated in #137) — prefer these over ad-hoc queries.
- Writes stay in action modules (`.update(users)`, `.insert().onConflictDoUpdate()` in sync routes).
- `scripts/migrate.mjs` runs `CREATE EXTENSION IF NOT EXISTS vector;` before migrating (pgvector; only needed to replay migration 0000's `vector(1536)` column for `activity_embeddings`, which #292 dropped).

## Error handling
- `lib/observability.ts` exports `captureError` (serializes only `name`/`message`/`cause` — never raw thrown values). Use it in catch blocks; never `console.log(error)` with token/connection data (#135, #143).

## Tests
- `__tests__/` mirrors `lib/` and feature dirs (`db/`, `cobalt/`, `ai/`, `strava/`, `hooks/`, `coach/`, `training/`, `actions/`, `e2e/`).
- `vitest.config.ts`: node env, `@` alias, **excludes `__tests__/e2e/**`**, coverage threshold ~82%.
- `npm run test:e2e` runs Playwright (4 specs) — not a stub.
- Validate changes with: `biome check . && tsc --noEmit && vitest run`.

## Working in a git worktree
A fresh `git worktree add` has **no `node_modules`**. Symlink the main checkout's `node_modules` rather than running a slow `npm ci` — it is gitignored and `worktree remove --force` only drops the symlink. Always use a separate worktree per parallel CC session to avoid `git checkout`/`commit` races.

## Brand (Cobalt Glass)
- Colors: Cobalt `#1b29c0`, Red `#ee2418`, Silver `#e9eae5`, Ink `#5560a8`. Tokens + `cg-*` utilities in `app/globals.css`.
- Typography: Bricolage Grotesque (display), Instrument Sans (UI), Instrument Serif (heroes, italic), Spline Sans Mono (data) — `lib/fonts.ts`.
- Legacy "Volt" system (`StrideLogo`/`StrideLoader`, Geist/Space Grotesk) has been **removed** — do not reference it.

## The coach engine (#292 — no LLM anywhere)
Strava's API Policy 2026 §5.3 forbids using Strava data — including derived, anonymised or aggregated data — in "any AI Application", explicitly including "ingestion into a context window or working memory". §5.10 forbids passing it to AI providers, and §5.16(b) forbids MCP/agent-mediated interfaces that expose it. So the model-led half of this app is **deleted**, not gated behind a key, and **must not be reintroduced** — no OpenRouter/`ai`-SDK/embeddings/local-ML replacement either.

What remains is the deterministic engine, and it is the whole product:
- `lib/coach/*` — rule engine + recommender (recovery buffer, shoe, volume budget).
- `lib/training/*` — progression snapshot, acute:chronic load, pace efficiency, zones.
- `lib/cobalt/readiness.ts` — the one readiness mapping every surface reads.
- `lib/ai/analysis.ts` — `buildAnalysisInput` (reduce activities to a summary) + `heuristicBlocks` (turn that summary into typed blocks).
- `lib/ai/tools.ts` — the block contract (zod schemas) used by the heuristic **and** rendered by `CoachFeed`. Not model-facing any more; keep it whole.
- `app/api/ai/analyze/route.ts` — the only AI-named route left. It is a deterministic NDJSON block stream: no provider, no cache, no session gating. Per-IP rate limit + anonymous payload cap.

Deleted in #292 and not to be referenced: `lib/ai/provider.ts`, `lib/ai/harmony.ts`, `lib/ai/coach-tools.ts`, `app/api/ai/chat/`, `actions/chat.ts`, `components/cobalt/coach/ChatPanel.tsx` (and `MessageBubble`/`ChatMarkdown`/`ActivityCard`), `lib/cobalt/chat-markdown.ts`, `types/chat.ts`, and the `chat_messages` / `ai_analyses` / `activity_embeddings` tables (dropped in `drizzle/migrations/0009_*`).

`scripts/migrate.mjs` still runs `CREATE EXTENSION IF NOT EXISTS vector` — migration 0000 creates a `vector(1536)` column, so a fresh database needs the extension to replay the history even though nothing reads that table any more.

## Env vars (see `.env.example`)
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `RESEND_API_KEY`, `STRAVA_*`, `ENCRYPTION_KEY` (AES-256-GCM), `UPSTASH_REDIS_REST_URL/TOKEN`.
