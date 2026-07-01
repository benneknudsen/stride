<p align="center">
  <img src="public/stride-icon.svg" alt="Stride" width="96" height="84" />
</p>

<h1 align="center">Stride</h1>

<p align="center">AI-powered running coach — Strava sync, progression analysis, generative UI</p>

<p align="center">
  <a href="https://stride-ochre-five.vercel.app"><strong>Live → stride-ochre-five.vercel.app</strong></a> ·
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
| Testing | Vitest (255 tests) |
| CI/CD | Vercel (automatic deploys) |
| LLM Agents | Hermes + Claude Code (Opus, high effort) |

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

### AI-First Workflow

```
Hermes                 →  Plans, verifies, manages issues
Claude Code (Opus)     →  Implements features via GitHub Issues
Sub-agents (parallel)  →  Code review, security audit, test verification
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

## Project Status

### ✅ Phase 1 — Complete

- [x] Architecture + project scaffold
- [x] Database schema (Drizzle + PostgreSQL)
- [x] NextAuth v5 foundation
- [x] Strava PKCE OAuth + encrypted token storage
- [x] Activity sync pipeline
- [x] Dashboard (weekly volume, pace distribution, zone breakdown)
- [x] Activity detail page
- [x] AI analysis with generative UI (streamObject + 4 typed tools)
- [x] Training plan dashboard (committed plan, latest run, last 5, next run)
- [x] Deploy to Vercel + Neon Postgres
- [x] 255 unit tests

### 🏗️ Phase 2 — Coach Intelligence

- [ ] [#30 Progression metrics engine](../../issues/30) — pace/HR trends, training load
- [ ] [#31 Coach rule engine](../../issues/31) — 155 bpm, 48h buffer, phases
- [ ] [#32 Workout recommender](../../issues/32) — next workout engine
- [ ] [#33 Coach insight cards](../../issues/33) — AI-generated coaching messages
- [ ] [#34 Coach dashboard](../../issues/34) — unified coaching view

## Author

**Benjamin Knudsen** — [GitHub](https://github.com/benneknudsen)

*Built with Hermes + Claude Code*
