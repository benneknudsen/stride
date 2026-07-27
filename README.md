<p align="center">
  <img src="public/app-icon.svg" alt="Stride" width="96" height="96" />
</p>

<h1 align="center">Stride</h1>

<p align="center">AI-powered running coach — Strava sync, progression analysis, generative UI</p>

<p align="center">
  <a href="https://stride-run.club"><strong>Live → stride-run.club</strong></a> ·
  <a href="../../issues">Issues</a> ·
  <a href="./docs/architecture.md">Architecture</a>
</p>

---

## What is Stride?

A Next.js 16 running coach platform that connects to Strava, visualizes training data with rich dashboards, and generates personalized insights via **generative AI** — the AI calls typed tools that render pre-defined React components, not plain text.

It's designed to replace a manual running-coach workflow with an intelligent, data-driven platform.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| AI | Vercel AI SDK (streamObject, typed tools) |
| Database | Drizzle ORM + Neon (Vercel Postgres) |
| Auth | NextAuth.js v5 |
| Charts | Recharts |
| Testing | Vitest (887 tests) |
| CI/CD | Vercel (automatic deploys) |
| LLM Agents | Hermes (Orchestrator) + Claude Code (Opus, Fable) |

## Architecture

### Generative UI

Instead of streaming text, the AI endpoint (`app/api/ai/analyze`) streams typed tool calls as NDJSON. Each tool maps to a validated React component:

| Tool | Component | Purpose |
|---|---|---|
| `insight-card` | `InsightCard` | Severity-dotted observations |
| `trend-callout` | `TrendCallout` | Directional deltas with sparklines |
| `workout-recommendation` | `WorkoutRecommendation` | Suggested next run |
| `metric-comparison` | `MetricComparison` | Week-over-week stats |
| `coach-insight` | `CoachInsight` | Personalized coaching messages |

### Key Design Decisions

- **Generative UI over plain text** — AI calls typed tools, pre-defined components render
- **Server-side AI only** — API keys never reach the browser
- **Drizzle over Prisma** — SQL-first, edge-compatible
- **NextAuth over Clerk** — Free, demonstrates OAuth competence
- **AES-256-GCM encrypted tokens** — Per-row IVs for Strava OAuth tokens
- **Heuristic fallback** — AI analysis works without API key for demo/portfolio

### Landing & Brand

- **Velkommen landing page** ([#119](../../issues/119)) — public visitors get a branded landing page with live preview widgets; the demo dashboard lives at `/demo`
- **AI coach teaser** ([#121](../../issues/121)) — coach analysis rendered as a typewriter loop on the landing page
- **Open Graph social card** ([#120](../../issues/120)) — `app/opengraph-image.tsx` with Bricolage wordmark + serif-italic tagline
- **Cobalt Glass design system** — light "silver paper" theme with liquid-glass surfaces: `components/cobalt/` (UI) + `lib/cobalt/` (view-models), tokens in `app/globals.css`

### AI-First Workflow

```
Hermes (Orchestrator)     →  Planlægger, verificerer, håndterer issues
Claude Code (Opus/Fable)  →  Implementerer features via GitHub Issues
```

## Getting Started

```bash
git clone https://github.com/benneknudsen/stride.git
cd stride
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Required env vars: `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY` (see `.env.example` for all).

## Status

Live in production at **[stride-run.club](https://stride-run.club)**, deployed on Vercel with Neon Postgres.

The MVP and coach intelligence work are shipped: Strava PKCE OAuth with encrypted token storage, the activity sync pipeline, the Cobalt Glass dashboards (weekly volume, pace distribution, zone breakdown), AI analysis via generative UI, the progression + coaching engines, and the chat coach at `/dashboard/coach`. Backed by 887 passing tests. Active development continues via GitHub Issues.

## Author

**Benjamin Knudsen** — [GitHub](https://github.com/benneknudsen)

*Built with Hermes + Claude Code*
