<p align="center">
  <img src="public/app-icon.svg" alt="Stride" width="96" height="96" />
</p>

<h1 align="center">Stride</h1>

<p align="center">Rule-engine running coach — Strava sync, progression analysis, live insight cards</p>

<p align="center">
  <a href="https://stride-run.club"><strong>Live → stride-run.club</strong></a>
</p>

---

## What is Stride?

A Next.js running coach platform that connects to Strava, visualizes training data with rich dashboards, and coaches from a deterministic rule engine. Every insight is arithmetic over the athlete's own runs — no model call, no key, no data leaving the server.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| Coach | Deterministic rule engine + typed block stream |
| Database | Drizzle ORM + Neon Postgres |
| Auth | NextAuth.js v5 |
| Charts | Recharts |
| Testing | Vitest + Playwright |
| CI/CD | Vercel (automatic deploys) |

## Architecture

### Typed insight cards

The analyze endpoint (`/api/ai/analyze`) reduces the athlete's activities to a
compact summary and streams typed blocks as NDJSON. Each block validates against
a zod schema and renders as a pre-defined React component:

| Block | Component | Purpose |
|---|---|---|
| `insight-card` | `InsightCard` | Severity-dotted observations |
| `trend-callout` | `TrendCallout` | Directional deltas with sparklines |
| `workout-recommendation` | `WorkoutRecommendation` | Suggested next run |
| `metric-comparison` | `MetricComparison` | Week-over-week stats |
| `coach-insight` | `CoachInsight` | Personalized coaching messages |

The block schemas in `lib/ai/tools.ts` are the single source of truth: they
drive the runtime validation and the component props, so a block that does not
validate is simply not rendered. The same contract is what `CoachFeed` renders on
`/dashboard/coach`.

Everything the coach says is computed by the engine in `lib/coach/*`,
`lib/training/*` and `lib/ai/analysis.ts` — the recommender's recovery buffer, the
progression engine's acute:chronic load ratio, and the readiness mapping in
`lib/cobalt/readiness.ts`. The cards are prose-free: the numbers come from the
arithmetic, so a card can never state something the engine did not derive.

### Design Decisions

- **Deterministic coach** — the recommendation is a pure function of the athlete's own activities, so the same data always yields the same advice
- **No model in the loop** — Strava's API Policy 2026 §5.3 forbids putting Strava data (even derived, anonymised or aggregated) into an AI application, so nothing is sent to one
- **Typed blocks over plain text** — validated blocks rendered by pre-defined components
- **Drizzle over Prisma** — SQL-first, edge-compatible
- **AES-256-GCM encrypted tokens** — per-row IVs for OAuth tokens

### Design System

Cobalt Glass — a light "silver paper" theme with liquid-glass surfaces. Custom component library (`components/cobalt/`) + view-models (`lib/cobalt/`), with branded typography (Bricolage Grotesque, Instrument Sans/Serif) and an Open Graph social card.

## Status

Live in production at **[stride-run.club](https://stride-run.club)**, deployed on Vercel with Neon Postgres.

## Author

**Benjamin Knudsen** — [GitHub](https://github.com/benneknudsen)
