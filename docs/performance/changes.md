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
| T4: RouteMap/OpenFreeMap-fliser deferret til viewport (IntersectionObserver 400px) | Desktop-lab uændret (TBT/SI inden for støj) — fliser var ikke flaskehals | fliser hentes ikke ved load; mobil/below-fold sparer ~3.7 MB initial transfer; CLS 0 | LHCI 13.6 | 2026-11-06 | `989c1ea` |
| T5: WCAG AA-kontrast (tokens `--color-red-ink`/`--color-strava-deep`, `text-ink/60-80`→`text-ink`) | axe `color-contrast` (serious): `/` 4, `/demo` 7, `/aktiviteter` 9, `/plan` 4, `/coach` 31, `/login` 1 | `/` 0, `/demo` 0, `/aktiviteter` 0, `/plan` 0, `/coach` 0, `/login` 1 (Strava-brandknap accepteret) | axe 4.14 (npm run test:a11y) | 2026-11-06 | `9b3ad14` |
| T6: login-entrance transform-only (ikke opacity 0) → LCP venter ikke på hydration | Perf 0.85 · LCP 4.45 s · FCP 0.60 s · TBT 38 ms | **Perf 1.00 · LCP 0.60 s** · FCP 0.60 s · TBT 36 ms | LHCI 13.6 | 2026-11-06 | `ad47e11` |

## Prod-probe (2026-11-06, stride-run.club — reference, signed-out demo)

| Side | Perf | A11y | LCP | TBT | Note |
|------|-----:|-----:|----:|----:|------|
| `/` | 0.62 | 1.0* | 1.19 s | 2112 ms | Client-side main-thread på landing; ikke fliser |
| `/demo` | 0.75 | — | 1.00 s | 972 ms | Samme mønster som `/` |
| `/aktiviteter` | 1.00 | — | 0.81 s | 57 ms | |
| `/plan` | 1.00 | — | 0.80 s | 48 ms | |
| `/dashboard/coach` | 0.99 | — | 0.95 s | 70 ms | |
| `/login` | 0.93 | — | 3.18 s | 77 ms | LCP-halet; efter T6 skal re-måles på prod |

*A11y-scoren i baseline (0.95–0.98) og axe-fundet er fra den fulde lab-kørsel; prod-proben målte
kun kategori-scores. T5-fikset er en TM-forbedring → casen bruger baseline-tallene med T5-EFTER fra
lab; det understreges i case-teksten ("lab-baseret måling, reproducerbar kommando").

## Noter (efter T4–T6)
- **T4-lærdom:** fliserne var ikke den målte flaskehals — landing-sidens client-side main-thread
  (`MT Other ~5.5 s` + `Script Evaluation ~1.9 s`, `unusedJS ~145 KiB` i et delt chunk) er det.
  `/plan` scorer 1.0 selv med fliser. Defer-fikset er stadig rigtig for mobil/initial-transfer.
- **T5-lærdom:** én regel (`color-contrast` på glasfladerne) holdt alle A11y-scorer nede; token-roden
  (2 nye mørkere farver + fuld ink) fjernede den på alle sider uden at røre brand-farverne.
- **T6-lærdom:** LCP 4.45 s var en self-inflicted animation (`opacity: 0` + client hydration);
  transform-only entrance (scale/y, ingen opacity-fade) gav LCP = FCP = 0.60 s uden visuelt tab.
- **Feltdata (CrUX/Speed Insights) er endnu ikke tilgængelige** — trafikken er for lav til en
  pålidelig P75, og Vercel-hobbyplanen begrænser dataindsamling. Dette er en lab-baseret case;
  kommandoen er dokumenteret og reproducerbar.
