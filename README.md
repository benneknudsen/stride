<p align="center">
  <img src="public/stride-icon.svg" alt="Stride" width="96" height="84" />
</p>

<h1 align="center">Stride</h1>

<p align="center">AI-powered running training dashboard</p>

<p align="center">
  <strong><a href="#">Live Demo</a></strong> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="../../issues">Issues</a>
</p>

---

## What is this?

A Next.js 16 application that connects to Strava, analyzes your running data with AI, and presents insights through **generative UI** — the AI returns typed React components, not just text.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, PPR, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| AI | Vercel AI SDK (streamUI, generative UI, provider routing) |
| Database | Drizzle ORM + Vercel Postgres |
| Auth | NextAuth.js v5 |
| Charts | Recharts |
| Deployment | Vercel |

## Architecture

Full architecture document: [`docs/architecture.md`](./docs/architecture.md)

### Key Design Decisions

- **Generative UI over plain text** — AI calls typed tools, pre-defined components render with validated props
- **Server-side AI only** — API keys never reach the browser. Controllable caching, GDPR boundaries
- **Drizzle over Prisma** — SQL-first, edge-compatible, shows SQL fluency
- **NextAuth over Clerk** — Free, demonstrates OAuth competence, no vendor lock-in
- **Encrypted OAuth tokens at rest** — AES-256-GCM, per-row initialization vectors

### AI-First Workflow

This project is built with an **orchestrator-agent architecture**:

```
Hermes                 →  Plans, verifies, reports, manages issues
Claude Code (Opus)     →  Implements features via GitHub Issues
Claude Code (Sonnet)   →  Parallel sub-agents for review & testing
```

**Orchestration loop:**
1. Hermes breaks down features into GitHub Issues with clear specs
2. Claude Code (Opus) implements each issue, opens a PR
3. On review, three Claude Code sub-agents run in parallel:
   - `security-reviewer` — audits auth, tokens, API key exposure
   - `test-runner` — runs test suite, type checking, lint
   - `query-optimizer` — checks Drizzle queries for N+1, missing indexes
4. Hermes verifies the result and closes the issue

**Custom slash commands:**
- `/code-review` — review current diff
- `/security-review` — security audit of pending changes
- `/verify` — verify a change works
- `/run` — launch and test the app
- `/deep-research` — multi-source research report

## Getting Started

```bash
git clone https://github.com/benneknudsen/stride.git
cd stride
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

## Phase 1 (MVP)

- [x] Architecture design
- [ ] Project scaffold
- [ ] Database schema + Drizzle
- [ ] Auth foundation
- [ ] Strava OAuth + token management
- [ ] Activity sync pipeline
- [ ] Dashboard with charts
- [ ] Activity detail page
- [ ] AI analysis with generative UI
- [ ] Demo mode (seeded data)
- [ ] Deploy to Vercel

## Phase 2 (Roadmap)

- [ ] RAG chatbot (pgvector embeddings)
- [ ] Training plan suggestions
- [ ] Performance benchmarking

## Author

**Benjamin Knudsen** — [GitHub](https://github.com/benneknudsen)

*Built with Hermes + Claude Code*
