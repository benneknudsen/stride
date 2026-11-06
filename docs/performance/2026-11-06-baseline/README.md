# Baseline 2026-11-06

Lighthouse 13.6.0 / LHCI 0.16.0, median af 5 runs pr. side, lokalt produktionsbuild
(`npm run build` + `AUTH_URL=http://localhost:3000 npm start`), signed-out (demo-fixtures).

- `lighthouse/local/` — 30 rå Lighthouse-rapporter (JSON).
- `lighthouse/local/summary.json` — whitelisted ekstraktion (kategorier + LCP/CLS/TBT/FCP/SI,
  median pr. URL) lavet med `npm run perf:extract`.

Kommando gentaegelig:
```bash
npm run build
LHCI_OUT=docs/performance/2026-11-06-baseline/lighthouse/local npm run perf:lhci
node scripts/perf/extract-scores.mjs docs/performance/2026-11-06-baseline/lighthouse/local docs/performance/2026-11-06-baseline/lighthouse/local/summary.json
```

Tal-opsummering: `docs/performance/changes.md`.
