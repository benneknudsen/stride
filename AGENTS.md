<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Stride — Agent Rules (AGENTS.md)

Repo: `benneknudsen/stride` — AI-powered running training dashboard (Next.js 16 App Router).

## Stack (exact)
- Next.js 16, App Router, TypeScript strict
- Tailwind CSS + shadcn/ui (new-york style, zinc base)
- Vercel AI SDK (`streamText` / `streamObject`, OpenRouter provider routing in `lib/ai/provider.ts`)
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
- AI keys NEVER reach the browser — every AI call goes through `/api/ai/*` (`lib/ai/provider.ts` routes OpenRouter; chat coach via `streamText` + tool calls, activity analysis via `streamObject` with deterministic heuristic fallback when no key is set).
- OAuth tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM); `ENCRYPTION_KEY` in env.
- Component files: PascalCase, one component per file (except shadcn/ui).
- Imports sorted by Biome (organizeImports). No default exports except Next.js page/layout.
- All app routes centralized in `lib/routes.ts` — never hardcode paths. `DEMO_HOME_ROUTE` (`/demo`) rewrites to the front page reading `?demo=1`; `LEGACY_COACH_ROUTE` (`/coach`) permanently redirects to `ROUTES.COACH` (`/dashboard/coach`).

## Architecture
`docs/architecture.md` is the original plan but the codebase has evolved past it — treat as historical, not authoritative.
- Drizzle over Prisma; NextAuth v5 over Clerk; server-side AI only (cost/GDPR/key security).
- Event-driven revalidation over ISR (running data changes on new activity only).
- **Cobalt Glass** is the standard design: `components/cobalt/` (UI) + `lib/cobalt/` (view-models, Danish: `hjem.ts`, `plan.ts`, `aktiviteter.ts`). Pages are Danish: `/` (hjem), `/aktiviteter`, `/plan`.
- Coach lives at `/dashboard/coach` only (#86); old `/coach` permanently redirects.
- Race date is per-user (#99): `actions/race.ts` + `getRacePlan`, engine demo race as fallback.
- Visitors (no session) get the Velkommen landing on `/` (`components/cobalt/velkommen/`); the public demo lives at `/demo`; `LandingChromeGate` hides NavBar/BottomTabBar on the landing.

## Demo mode
Live data is default (#84): authed users get their own synced activities + race plan. Demo fixtures (`lib/demo/data.ts`, 30 deterministic activities, **no `Math.random`** so SSR/hydration agree) are the fallback for signed-in users with no synced runs, and power `/demo` + landing preview widgets. View-models default to `demoActivities` and switch to live when synced runs exist (e.g. `lib/cobalt/hjem.ts:354`).

## Auth boundary (read before touching auth)
- `auth.config.ts` — shared NextAuth config; `trustHost: true` is set so self-hosted prod doesn't reject requests (Auth.js only infers this with `VERCEL`/`AUTH_URL`/`AUTH_TRUST_HOST` set). Set `AUTH_URL` to the canonical origin in prod.
- `proxy.ts` — edge middleware: sets the **per-request CSP nonce** (load-bearing security — `#89` removed `'unsafe-inline'`), enforces `trustHost` on every request, and reads the session at the edge. Because of the nonce, pages render dynamically (static caching is intentionally unavailable).

## DB access layer
- `lib/db/queries.ts` centralizes user-owned reads (consolidated in #137) — prefer these over ad-hoc queries.
- Writes stay in action modules (`.update(users)`, `.insert().onConflictDoUpdate()` in sync routes).
- `scripts/migrate.mjs` runs `CREATE EXTENSION IF NOT EXISTS vector;` before migrating (pgvector for `activity_embeddings`).

## Error handling
- `lib/observability.ts` exports `captureError` (serializes only `name`/`message`/`cause` — never raw thrown values). Use it in catch blocks; never `console.log(error)` with token/connection data (#135, #143).

## Tests
- `__tests__/` mirrors `lib/` and feature dirs (`db/`, `cobalt/`, `ai/`, `garmin/`, `strava/`, `hooks/`, `coach/`, `training/`, `actions/`, `e2e/`).
- `vitest.config.ts`: node env, `@` alias, **excludes `__tests__/e2e/**`**, coverage threshold ~82%.
- `npm run test:e2e` runs Playwright (4 specs) — not a stub.
- Validate changes with: `biome check . && tsc --noEmit && vitest run`.

## Working in a git worktree
A fresh `git worktree add` has **no `node_modules`**. Symlink the main checkout's `node_modules` rather than running a slow `npm ci` — it is gitignored and `worktree remove --force` only drops the symlink. Always use a separate worktree per parallel CC session to avoid `git checkout`/`commit` races.

## Brand (Cobalt Glass)
- Colors: Cobalt `#1b29c0`, Red `#ee2418`, Silver `#e9eae5`, Ink `#5560a8`. Tokens + `cg-*` utilities in `app/globals.css`.
- Typography: Bricolage Grotesque (display), Instrument Sans (UI), Instrument Serif (heroes, italic), Spline Sans Mono (data) — `lib/fonts.ts`.
- Legacy "Volt" system (`StrideLogo`/`StrideLoader`, Geist/Space Grotesk) has been **removed** — do not reference it.

## Env vars (see `.env.example`)
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `RESEND_API_KEY`, `GARMIN_*`, `STRAVA_*`, `ENCRYPTION_KEY` (AES-256-GCM), `UPSTASH_REDIS_REST_URL/TOKEN`, `OPENROUTER_API_KEY`, `AI_PRIMARY`/`AI_FALLBACK`.
