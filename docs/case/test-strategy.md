# Teststrategi

Stride har to testlag med hver sin opgave: Vitest som enhedskontrakt og
Playwright som bevis på, at delene virker sammen gennem en kørende server.
Tallene nedenfor er målt 2026-11-06.

## Vitest — enhedskontrakt

`npx vitest run` gav 1462 tests i 81 testfiler med 0 fejl.

Testene ligger under `__tests__/` og spejler `lib/` og feature-mapperne.
Tyngdepunkterne er:

- `__tests__/coach/` — motoren: recommender, next-activity, run-review, plan,
  feed og komponenter.
- `__tests__/ai/` — analysen: `buildAnalysisInput`, `heuristicBlocks` og
  blok-kontrakten.
- `__tests__/auth/` — auth-konfiguration og relaterede grænser.
- `__tests__/e2e/` — deles med Playwright, men Vitest-kørslen udelukker
  `__tests__/e2e/**` via `vitest.config.ts`.
- Enhedstests for scripts og perf: LHCI-ekstraktoren, axe-summary
  (`__tests__/scripts/extract-scores.test.ts`,
  `__tests__/scripts/a11y-whitelist.test.ts`) samt RouteMap.

Vitest kører i node-miljø og bruger jsdom til komponentrendering. Det er her,
jeg tester udfald: giver motoren det rigtige review, validerer schemaet den
rigtige form, og renderer komponenten den rigtige tekst. En enhedstest fejler
tæt på årsagen.

## Playwright — hele flows

`npm run test:e2e` kører 22 tests i 5 specs:

- `navigation.spec.ts` — navigation gennem appen.
- `visitor.spec.ts` — signed-out adfærd og demo-fallbacks.
- `aktiviteter.spec.ts` — aktivitetsflowet.
- `plan.spec.ts` — plan-flowet.
- `a11y.spec.ts` — axe (collect-only).

`auth.setup.ts` logger ind via dev-login. Credentials-provideren findes kun i
development, så e2e-suiten behøver ingen ekstern identitetsudbyder.

Grænsen er bevidst: Vitest beviser enhedskontrakten, Playwright beviser, at
navigation, signed-out parring, demo-fallback, plan-flow og a11y-indsamling
fungerer gennem en rigtig server. Enhedstesten fejler først; e2e viser, at det
hænger sammen.

## Det er bevidst ikke testet

- **Rigtig Strava OAuth.** Det kræver en live tredjepart. Dev-login er
  substitut, ikke en erstatning for den rigtige provider.
- **Fuld Strava-sync mod produktion.** Testene kører ikke mod produktionsdata
  eller produktions-API'et.
- **Motion og reduced-motion visuelt.** Der asserteres på effekten — via
  motion-dom-cachen og duration 0 — ikke på, hvordan animationen ser ud.
- **Animations-UX.** Animeret bevægelse er en visuel oplevelse og testes ikke
  som sådan.
- **e2e mod en lokal database-løs opsætning.** Suiten kører mod demo-fallbacks,
  ikke mod en seedet produktionslignende database.

Jeg har valgt den grænse, fordi de udeladte ting kræver enten en live
tredjepart eller en visuel vurdering. De er dokumenteret her, så de ikke ender
som skjulte huller.
