# Performance-målinger — ændringslog & baseline

Protokol: `docs/performance/README.md`
Alle tal = Lighthouse-loops (median af 5 motorkøret), samme værktøj/version (LHCI 0.16.0,
Lighthouse 13.6.0), Google Chrome-headless via Playwright-Installeret Chromium.

## Baseline — 2026-11-06 (lokalt produktionsbuild, signed-out)

Kommando: `npm run build && LHCI_OUT=docs/performance/2026-11-06-baseline npm run perf:lhci`
Miljø: macOS Node 26, `startServerCommand` med `AUTH_URL=http://localhost:3000 npm start`.
Rå rapporter: `docs/performance/2026-11-06-baseline/lighthouse/local/` (30 LHR-JSON).

| Side           | Perf | A11y | Best-Practices | SEO | LCP | CLS | TBT |
|----------------|-----:|-----:|---------------:|----:|----:|----:|----:|
| `/` (landing)  | 0.69 | 0.95 |           0.96 | 1.0 | 0.78 s | 0.000 | 1995 ms |
| `/demo`        | 0.75 | 0.95 |           0.96 | 1.0 | 0.79 s | 0.000 | 930 ms |
| `/aktiviteter` | 1.00 | 0.95 |           0.96 | 1.0 | 1.08 s | 0.001 | 18 ms |
| `/plan`        | 1.00 | 0.95 |           0.96 | 1.0 | 0.64 s | 0.000 | 18 ms |
| `/dashboard/coach` | 0.99 | 0.96 |        0.92 | 1.0 | 0.75 s | 0.000 | 57 ms |
| `/login`       | 0.85 | 0.98 |           0.96 | 1.0 | 4.45 s | 0.000 | 38 ms |

**Axe (WCAG A/AA, mobil 390×844):** `color-contrast` (serious) på alle 6 sider —
`/` 4, `/demo` 7, `/aktiviteter` 9, `/plan` 4, `/dashboard/coach` 31, `/login` 1 node.

## Ændringer (Ændring → før → efter)

| Ændring | Før | Efter | Værktøj | Dato | SHA |
|---|---|---|---|---|---|
| *(tom — udfyldes af T4–T6)* | | | | | |

## Noter
- TBT/SpeedIndex trækkes kraftigt ned af globale OSM-vektorfliser (~3.7 MB `.pbf` baggrund) som
  `/` og `/demo` henter — LCP er hurtig (0.8 s), men main-thread bliver opbrugt.
- `/login` er en let side (383 KiB) med LCP 4.45 s — render-blocking-relateret, reelt forhold til
  antallet af forhåndsindlæste scripts/fonts.
- A11y brutkede siderne: score 0.95–0.98 — alt hvad der trækker ned er één regel
  (`color-contrast` på glasfladerne).
- Øvrig audit: `errors-in-console` (browserkonsolfejl) på samtlige sider.
