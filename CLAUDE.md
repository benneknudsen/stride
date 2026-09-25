# stride — Running Training Dashboard (deterministic coach engine)

## Stack
- Next.js 16 with App Router + TypeScript strict
- Tailwind CSS + shadcn/ui (new-york style, zinc base)
- Drizzle ORM + Neon Postgres (`@neondatabase/serverless`, pooled WebSocket driver)
- NextAuth.js v5 (JWT session strategy with per-login `sid` rotation for session-fixation mitigation — email magic link + Google; dev Credentials login in development)
- Recharts 3.x
- Vercel deployment

## Commands
```bash
npm run dev          # Next.js dev server (port 6969)
npm run build        # DB migrations (scripts/migrate.mjs) + production build
npm run lint         # Biome lint
npm run format       # Biome format
npm run check        # Biome lint + format
npm run db:generate  # Drizzle generate migrations
npm run db:migrate   # Drizzle apply migrations
npm run db:studio    # Drizzle Studio
npm test             # Vitest (npm run test:watch for watch mode)
npm run test:e2e     # Playwright e2e (4 .spec.ts files in __tests__/e2e)
```

## Code conventions
- TypeScript strict mode — no `any` without explicit justification
- Server Components by default — add `'use client'` only when needed
- Server Actions in `actions/` — never in components
- No model in the loop (#292) — no AI keys exist, and no AI call may be reintroduced; Strava data never leaves the server (Strava API Policy 2026 §5.3/§5.10/§5.16(b))
- OAuth tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM)
- Component files: PascalCase, one component per file (except shadcn/ui)
- Imports: sorted by Biome (organize imports)
- No default exports except Next.js page/layout convention
- All app routes centralized in `lib/routes.ts` — never hardcode paths

## Architecture
See `docs/architecture.md` for the original plan (the codebase has evolved past it). Key design decisions:
- Drizzle over Prisma (SQL-first, edge-compatible, lighter)
- NextAuth v5 over Clerk (free, no vendor lock-in, demonstrates OAuth competence)
- No model in the loop (#292 — Strava policy compliance; also cheaper and fully reproducible)
- The coach IS the rule engine (`lib/coach/*`, `lib/training/*`, `lib/cobalt/readiness.ts`): `app/api/ai/analyze` streams deterministic blocks from `lib/ai/analysis.ts` against the zod block contract in `lib/ai/tools.ts`. The chat, the provider router, the agent tools and the three cached-AI tables were deleted in #292 and must not come back
- Event-driven revalidation over ISR (running data changes on new activity only)
- Cobalt Glass is the standard design — `components/cobalt/` (UI) + `lib/cobalt/` (view-models); pages are Danish: `/` (hjem), `/aktiviteter`, `/plan`
- Coach lives at `/dashboard/coach` only (#86); the old `/coach` permanently redirects
- Race date is per-user (#99) — `actions/race.ts` + `getRacePlan`, with the engine's demo race as fallback
- **Plan page** (#244): 3 phase-aware run suggestions (easy/tempo/long) with distance + pace targets, not a Mon–Sun schedule, from `getPlanSuggestions` in `lib/cobalt/plan.ts`. The user picks which to do today. Recovery buffer (24h/48h) is coach-side (#240).
- Race distance/goal via `RaceDateDialog` (#238/#239); goal anchors pace grid (#242).
- Readiness: asymmetric mapping in `lib/cobalt/readiness.ts` (#241) — plateau 0.8–1.15, steep overload penalty, gentle rested decline.
- Visitors (no session) get the Velkommen landing page on `/` (`components/cobalt/velkommen/`); the demo dashboard lives at `/demo` (`DEMO_HOME_ROUTE` in `lib/routes.ts`, a rewrite of `/?demo=1` in `next.config.ts` — legacy query links still work), and visitor navs point Hjem there so the demo stays browsable. The landing itself drops the app chrome — `LandingChromeGate` hides NavBar/BottomTabBar there, and the page brings its own header

## Demo mode
Live data is the default (#84): authenticated users get their own synced activities and race plan. Demo fixtures are the fallback for signed-in users with no synced runs, and power the public demo at `/demo` plus the landing page's preview widgets.
Demo data path: `lib/demo/` — 30 realistic running activities, fully deterministic (no `Math.random`) so server render and client hydration agree.

## Roadmap
Phase 1 MVP (Strava OAuth → dashboard → deterministic block analysis with streaming → deploy) is shipped.
The Phase 2 chat coach was built and then removed in #292 — see the "coach engine"
note in `AGENTS.md` for why it may not be reintroduced.

## Brand Identity (Cobalt Glass)
- **Design system:** Cobalt Glass — light "silver paper" theme with liquid-glass surfaces. Tokens + `cg-*` utilities in `app/globals.css`
- **Colors:** Cobalt `#1b29c0` (primary), Red `#ee2418` (accent), Silver `#e9eae5` (background), Ink `#5560a8` (muted text)
- **Typography:** Bricolage Grotesque (display), Instrument Sans (UI), Instrument Serif (heroes — always italic), Spline Sans Mono (data/labels) — loaded in `lib/fonts.ts`
- **Components:** `Logo.tsx`, `Wordmark.tsx`, `RunnerLoader.tsx` in `components/cobalt/`
- Legacy "Volt" system (`StrideLogo.tsx`, `StrideLoader.tsx`, Space Grotesk/Geist fonts) has been **removed** — do not reference it.
- See `docs/design_handoff_cobalt_glass/` for the full redesign spec
