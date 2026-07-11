# stride — AI-Powered Running Training Dashboard

## Stack
- Next.js 16 with App Router + TypeScript strict
- Tailwind CSS + shadcn/ui (new-york style, zinc base)
- Vercel AI SDK (`streamText`/`streamObject`, OpenRouter provider routing in `lib/ai/provider.ts`)
- Drizzle ORM + Neon Postgres (`@neondatabase/serverless`, pooled WebSocket driver)
- NextAuth.js v5 (database sessions — email magic link + Google; dev Credentials login in development)
- Recharts 3.x
- Zustand (UI state only — never server data; server data flows through Server Components)
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
```
No e2e tests yet — `npm run test:e2e` intentionally exits 1.

## Code conventions
- TypeScript strict mode — no `any` without explicit justification
- Server Components by default — add `'use client'` only when needed
- Server Actions in `actions/` — never in components
- AI keys NEVER reach the browser — all AI calls through `/api/ai/*`
- OAuth tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM)
- Component files: PascalCase, one component per file (except shadcn/ui)
- Imports: sorted by Biome (organize imports)
- No default exports except Next.js page/layout convention
- All app routes centralized in `lib/routes.ts` — never hardcode paths

## Architecture
See `docs/architecture.md` for the original plan (the codebase has evolved past it). Key design decisions:
- Drizzle over Prisma (SQL-first, edge-compatible, lighter)
- NextAuth v5 over Clerk (free, no vendor lock-in, demonstrates OAuth competence)
- Server-side AI only (cost control, GDPR, key security)
- Chat coach via typed tools (`streamText` + tool calls); activity analysis via `streamObject` with a deterministic heuristic fallback when no AI key is set
- Event-driven revalidation over ISR (running data changes on new activity only)
- Cobalt Glass is the standard design — `components/cobalt/` (UI) + `lib/cobalt/` (view-models); pages are Danish: `/` (hjem), `/aktiviteter`, `/plan`
- Coach lives at `/dashboard/coach` only (#86); the old `/coach` permanently redirects
- Race date is per-user (#99) — `actions/race.ts` + `getRacePlan`, with the engine's demo race as fallback

## Demo mode
Live data is the default (#84): authenticated users get their own synced activities and race plan. Demo fixtures are the fallback for visitors and signed-in users with no synced runs.
Demo data path: `lib/demo/` — 30 realistic running activities, fully deterministic (no `Math.random`) so server render and client hydration agree.

## Roadmap
Phase 1 MVP (Strava OAuth → dashboard → AI analysis with streaming → deploy) is shipped.
The chat coach (Phase 2) is live at `/dashboard/coach` via `app/api/ai/chat`.

## Brand Identity (Cobalt Glass)
- **Design system:** Cobalt Glass — light "silver paper" theme with liquid-glass surfaces. Tokens + `cg-*` utilities in `app/globals.css`
- **Colors:** Cobalt `#1b29c0` (primary), Red `#ee2418` (accent), Silver `#e9eae5` (background), Ink `#5560a8` (muted text)
- **Typography:** Bricolage Grotesque (display), Instrument Sans (UI), Instrument Serif (heroes — always italic), Spline Sans Mono (data/labels) — loaded in `lib/fonts.ts`
- **Components:** `Logo.tsx`, `Wordmark.tsx`, `RunnerLoader.tsx` in `components/cobalt/`
- Legacy "Volt" system (`StrideLogo.tsx`, `StrideLoader.tsx` in `components/ui/`, Space Grotesk/Geist fonts) is still in the repo but unused
- See `docs/design_handoff_cobalt_glass/` for the full redesign spec
