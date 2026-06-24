# run-dashboard — AI-Powered Running Training Dashboard

## Stack
- Next.js 16 with App Router + TypeScript strict
- Tailwind CSS + shadcn/ui (new-york style, zinc base, neutral accent)
- Vercel AI SDK (streamUI, provider routing)
- Drizzle ORM + Vercel Postgres
- NextAuth.js v5 (database sessions)
- Recharts 2.x
- Zustand (UI state only — never server data)
- TanStack Query (server cache)
- Vercel deployment

## Commands
```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # Biome lint
npm run format       # Biome format
npm run db:generate  # Drizzle generate migrations
npm run db:migrate   # Drizzle apply migrations
npm run db:studio    # Drizzle Studio
npm test             # Vitest
npm run test:e2e     # Playwright
```

## Code conventions
- TypeScript strict mode — no `any` without explicit justification
- Server Components by default — add `'use client'` only when needed
- Server Actions in `actions/` — never in components
- AI keys NEVER reach the browser — all AI calls through `/api/ai/*`
- OAuth tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM)
- Component files: PascalCase, one component per file (except shadcn/ui)
- Imports: `lib/` first, then `components/`, then third-party
- No default exports except Next.js page/layout convention

## Architecture
See ARCHITECTURE.md for full plan. Key design decisions:
- Drizzle over Prisma (SQL-first, edge-compatible, lighter)
- NextAuth v5 over Clerk (free, no vendor lock-in, demonstrates OAuth competence)
- Server-side AI only (cost control, GDPR, key security)
- Generative UI via typed tools (model calls tools → our components render)
- Event-driven revalidation over ISR (running data changes on new activity only)

## Demo mode
ALWAYS build with seeded fixture data. Portfolio visitors won't connect Strava.
Demo data path: `lib/demo/` — 30 realistic running activities.

## Phase 1 MVP
Strava OAuth → dashboard → AI analysis with streaming generative UI → deploy.
RAG chatbot is Phase 2.
