# Code Review Findings — stride

Fuldt repo-review, 2026-07-20. Tre parallelle pass: validering, optimering, bugs & sikkerhed.

## Sammenfatning

| Pass | Fund | high | med | low |
|---|---|---|---|---|
| Pass 1 — Validering | 7 (5 status-grønne + 2 diagnostik) | 0 | 0 | 7 |
| Pass 2 — Optimering | 9 | 0 | 4 | 5 |
| Pass 3 — Bugs & sikkerhed | 7 | 0 | 2 | 5 |
| **I alt** | **23** | **0** | **6** | **17** |

**Validering: alt grønt.** `npm run build`, `npm run check`, `npm test` (912 tests), `npm run lint` og `tsc --noEmit` bestod alle uden fejl — kun 6 Biome-warnings + 2 infos, alle i testfiler/én komponent, de fleste auto-fixable. DB-migration blev skippet lokalt (ingen `POSTGRES_URL`), hvilket er en miljøbegrænsning, ikke en fejl.

**Vigtigste fund (med):**
1. Magic-link host-poisoning er kun konventionsbeskyttet — `trustHost: true` uden kode der enforcer `AUTH_URL` i produktion (auth.config.ts:113)
2. Chat-endpointet har ingen størrelsesgrænse på beskeder — multi-megabyte input går ubeskåret til modellen og DB (app/api/ai/chat/route.ts:62-69)
3. ChatPanel smider streamingen væk — svaret vises først når hele streamen er slut (components/cobalt/coach/ChatPanel.tsx:59-100)
4. Volt-rester lever stadig: `::selection` i Volt-grøn i globals.css og Volt-grøn default Button-variant på 404/error-siderne
5. CoachTeaser re-render'er ~38 gange/sek i en evig loop, også off-screen (components/cobalt/velkommen/CoachTeaser.tsx:33-57)

**Verificeret rent (pass 3):** lib/crypto.ts (korrekt AES-256-GCM, tilfældig IV), IDOR-flader (alle queries userId-scopede), SSRF-forsvar i Garmin-callback, CSP med nonce + strict-dynamic, rate limiting på AI/sync-endpoints, ingen `dangerouslySetInnerHTML`, ingen NEXT_PUBLIC-secrets, ingen åbne redirects, korrekt effect-cleanup overalt.

---

# Pass 1 — Validering

## [PASS1] npm run build: GRØN
**Beskrivelse:** Build ok (Next.js 16.2.9, Turbopack). Migration blev skippet med advarslen "No POSTGRES_URL — skipping migration" (miljøbegrænsning, ikke en fejl). 16 routes bygget, TypeScript-check under build ok.
**Sted:** -
**Alvorlighed:** low
**Forslag:** Ingen.

## [PASS1] npm run check: GRØN (med 6 warnings + 2 infos)
**Beskrivelse:** Biome check exit 0 — ingen errors, men 6 warnings og 2 infos i 213 filer.
**Sted:** -
**Alvorlighed:** low
**Forslag:** Se separate fund nedenfor.

## [PASS1] Biome-warnings i coach-tests
**Beskrivelse:** 6 warnings i __tests__/coach/components.test.tsx: 5x noNonNullAssertion (linje 226, 240, 286, 287, 333 — alle FIXABLE) og 1x noExplicitAny (linje 324: `pending as any` på fetch-mock).
**Sted:** __tests__/coach/components.test.tsx:226,240,286,287,324,333
**Alvorlighed:** low
**Forslag:** Kør `biome check --fix` for non-null assertions; typér fetch-mocken som `Promise<Response>` i stedet for `any`.

## [PASS1] Biome-infos (2 stk.)
**Beskrivelse:** lint/style/useTemplate i __tests__/coach/components.test.tsx:415 og lint/complexity/noUselessFragments i components/cobalt/LandingChromeGate.tsx:27 — begge FIXABLE.
**Sted:** __tests__/coach/components.test.tsx:415; components/cobalt/LandingChromeGate.tsx:27
**Alvorlighed:** low
**Forslag:** Auto-fix med Biome.

## [PASS1] npm test: GRØN
**Beskrivelse:** Vitest run: 47 testfiler, 912 tests — alle bestået (1.91s).
**Sted:** -
**Alvorlighed:** low
**Forslag:** Ingen.

## [PASS1] npm run lint: GRØN (med samme 6 warnings + 2 infos)
**Beskrivelse:** Biome lint exit 0. Samme diagnostik som `npm run check` (se fund ovenfor) — ingen errors.
**Sted:** -
**Alvorlighed:** low
**Forslag:** Ingen (dubletter af check-fund).

## [PASS1] npx tsc --noEmit: GRØN
**Beskrivelse:** TypeScript strict typecheck bestået uden fejl (exit 0, ingen output).
**Sted:** -
**Alvorlighed:** low
**Forslag:** Ingen.

---

# Pass 2 — Optimering

## [PASS2] ChatPanel smider streamingen væk — svaret vises først når hele streamen er slut
**Beskrivelse:** /api/ai/chat streamer NDJSON-fragmenter netop for progressiv rendering, men ChatPanel akkumulerer alle fragmenter i en lokal variabel og kalder først setMessages når streamen er færdig. Brugeren ser tre prikker i op til hele svartiden (tool-loop, maxDuration 60 s) i stedet for tekst der løber ind. Al infrastruktur for streaming findes allerede i begge ender — kun visningen mangler.
**Sted:** components/cobalt/coach/ChatPanel.tsx:59-100 (streamReply)
**Alvorlighed:** med
**Forslag:** Append et tomt coach-bubble ved stream-start og opdatér dets tekst pr. fragment (setMessages med opdateret sidste element), evt. throttlet pr. animation frame.

## [PASS2] Dødt legacy "Volt"-CSS i globals.css (tokens, keyframes, ::selection)
**Beskrivelse:** CLAUDE.md siger Volt-systemet er fjernet, men globals.css bærer det stadig: `--color-volt`/`--color-volt-dim`/`--color-signal`/`--color-aqua`, `--shadow-volt`, hele sidebar-token-sættet, samt keyframes `strideWave`/`strideStep`/`strideShimmer` og `.tabular`-utility — ingen af dem refereres i nogen komponent. Værre: `::selection { background: var(--color-volt) }` er stadig aktiv, så tekstmarkering i hele appen er Volt-grøn (#c6f432) på et Cobalt Glass-design.
**Sted:** app/globals.css:56-59,73,177-180 (::selection), 186-210 (keyframes), + sidebar/chart-tokens i :root og .dark
**Alvorlighed:** med
**Forslag:** Fjern de ubrugte Volt-tokens/keyframes/.tabular, og ret ::selection til et cobalt-token.

## [PASS2] Button-default-variant bruger stadig Volt-grøn — rammer 404/error-siderne
**Beskrivelse:** `buttonVariants` default er `bg-volt text-bg hover:bg-volt-dim` (det fjernede Volt-system). Den bruges live: app/not-found.tsx:16 (`buttonVariants({ size: "sm" })`) og components/dashboard/error-state.tsx:37 (`<Button size="sm">`) — 404- og fejlsiderne får altså Volt-grønne knapper på et Cobalt Glass-design. Volt-tokens kan ikke bare slettes uden også at rette denne variant.
**Sted:** components/ui/button.tsx:10 + app/not-found.tsx:16 + components/dashboard/error-state.tsx:37
**Alvorlighed:** med
**Forslag:** Ret default-varianten til cobalt-tokens (fx bg-cobalt text-silver), og fjern derefter Volt-tokens fra globals.css.

## [PASS2] CoachTeaser: evig typewriter-loop re-render'er ~38 gange/sek — også off-screen
**Beskrivelse:** Landing-sidens typewriter kalder setTyped hver 26 ms og looper for evigt (HOLD → wipe → replay). Det giver kontinuerlige re-renders af komponenten i hele sidens levetid, også når sektionen er scrollet ud af viewporten — unødig CPU/batteri på mobil. (Reduced-motion-brugere er korrekt undtaget.)
**Sted:** components/cobalt/velkommen/CoachTeaser.tsx:33-57
**Alvorlighed:** med
**Forslag:** Gate animationen med en IntersectionObserver (pausér når kortet ikke er synligt), og/eller stop loopet efter første gennemspilning; alternativt document.visibilityState-tjek.

## [PASS2] Ubrugte devDependencies: eslint + eslint-config-next
**Beskrivelse:** Biome er repoets linter (`npm run lint` = `biome lint .`). Der findes ingen eslint-config (ingen .eslintrc*/eslint.config.*), og intet script kalder eslint — `eslint@^9` og `eslint-config-next@16.2.9` installeres uden nogensinde at blive brugt.
**Sted:** package.json:61-62
**Alvorlighed:** low
**Forslag:** Fjern `eslint` og `eslint-config-next` fra devDependencies.

## [PASS2] Chat-route: getChatHistory awaites sekventielt efter Promise.all
**Beskrivelse:** Ruten paralleliserer getRacePlan + getDashboardActivities, men venter derefter separat på getChatHistory(userId, 50), som er uafhængig af de to første. Tre DB-reads kunne løbe i én Promise.all — som det er nu koster det en ekstra sekventiel DB-roundtrip pr. chatbesked.
**Sted:** app/api/ai/chat/route.ts:350-367
**Alvorlighed:** low
**Forslag:** Flyt getChatHistory ind i samme Promise.all som getRacePlan/getDashboardActivities.

## [PASS2] Død komponent: components/ui/input.tsx (refererer fjernede Volt-tokens)
**Beskrivelse:** `Input` importeres ingen steder (login-siden bruger et råt <input>). Komponenten bruger oven i købet `selection:bg-volt` fra det fjernede Volt-system.
**Sted:** components/ui/input.tsx
**Alvorlighed:** low
**Forslag:** Slet filen (eller genindfør den først når den faktisk bruges, i Cobalt-tokens).

## [PASS2] Gentaget mono-label-mønster (~89 forekomster) burde være en cg-utility
**Beskrivelse:** Kicker/label-mønstret `font-cg-mono text-[10-11px] uppercase tracking-[0.14-0.2em] text-ink` er duplikeret på tværs af ~30 filer (89 forekomster af font-cg-mono + text-[10/11px]; alene den eksakte streng `font-cg-mono text-[10px] uppercase tracking-[0.14em] text-ink` findes 9 gange, `tracking-[0.18em]`-varianten 8 gange). globals.css definerer allerede `@utility cg-glass`/`cg-interactive` — labels er det oplagte næste kandidat, og de små tracking/size-afvigelser (9.5/10/10.5/11px, 0.12-0.2em) ligner drift snarere end design.
**Sted:** components/cobalt/**/*.tsx (fx SectionHeading.tsx, hjem/VolumeCard.tsx, plan/WeekCalendar.tsx, coach-dashboard/*, aktiviteter/*)
**Alvorlighed:** low
**Forslag:** Tilføj `@utility cg-label` (evt. cg-label-sm) i globals.css og erstat de gentagne strenge; normalisér samtidig de tilfældige tracking/size-varianter.

## [PASS2] Coach-siden bygger hele dashboardet to gange pr. request med identiske inputs
**Beskrivelse:** `CoachPage` kalder `computeCoachDashboard(activities, raceDate, userId)` i selve page-body'en (til `buildLiveCoachView`) og igen inde i `NextWorkoutSection` med præcis samme argumenter. `computeCoachDashboard` → `buildCoachDashboard` genberegner hele progressions-serien (12 ugers snapshots over op til 500 aktiviteter), recommender og week strip — dobbelt server-CPU pr. request på en force-dynamic side.
**Sted:** app/(app)/dashboard/coach/page.tsx:78 og :185
**Alvorlighed:** low
**Forslag:** Beregn dashboardet én gang i CoachPage og giv resultatet som prop til NextWorkoutSection (eller wrap computeCoachDashboard i React cache()).

---

# Pass 3 — Bugs & sikkerhed

## [PASS3] Magic-link host-poisoning afhænger af en konvention, ikke af kode
**Beskrivelse:** `trustHost: true` er pinnet i auth-config, og neutraliseringen af host-header-spoofing hviler udelukkende på at `AUTH_URL` *er sat* i produktion (kommentaren i auth.config.ts siger det selv). Der er ingen kode der enforcer det: en self-hosted produktionsdeploy uden `AUTH_URL` bygger magic-link-URL'en fra requestens `Host`/`X-Forwarded-Host`, så en angriber kan requeste et login-link for et offer-email med spoofet host og få offeret til at sende det gyldige verifikationstoken til angriberens domæne (klassisk reset-link-poisoning → kontoovertagelse). Linket interpoleres direkte ind i mailen i lib/email.ts.
**Sted:** auth.config.ts:113 (trustHost), lib/email.ts:24-26
**Alvorlighed:** med
**Forslag:** Fail fast: throw ved opstart hvis `NODE_ENV === "production"` og hverken `AUTH_URL` er sat — eller validér Host mod en allowlist i sendVerificationRequest.

## [PASS3] Chat-endpoint: ubegrænset beskedlængde i request-schema
**Beskrivelse:** `chatMessageSchema` bruger `z.string()` uden `.max()`, og `messages`-arrayet har `.min(1)` men ingen øvre grænse. En autentificeret bruger kan sende multi-megabyte beskeder; `latest.content` sendes ubeskåret til modellen (token-omkostning) og persisteres ubeskåret i `chat_messages` (DB-bloat). Rate limit (30/min) begrænser antal kald, ikke størrelse.
**Sted:** app/api/ai/chat/route.ts:62-69 (schema), 416-418 (persist)
**Alvorlighed:** med
**Forslag:** Tilføj `.max(4000)` på content og `.max(50)` på messages; afvis eller trunkér oversize input.

## [PASS3] Strava-webhook: JSON.parse uden try/catch på verificeret body
**Beskrivelse:** Efter signaturtjek parses body med `JSON.parse(rawBody)` uden try/catch og castes uden validering. En signeret men malformet/uventet payload (fx `owner_id` mangler) giver en uhåndteret exception → 500 og Strava-retries i ~24 timer. Lav risiko (kræver gyldig HMAC), men fejl-håndteringen mangler.
**Sted:** app/api/strava/webhook/route.ts:78-84
**Alvorlighed:** low
**Forslag:** Wrap i try/catch → 400, og validér shape med zod i stedet for et rent cast.

## [PASS3] `shadcn` (CLI-værktøj) ligger i runtime-dependencies
**Beskrivelse:** `shadcn@^4.11.0` er et scaffolding-CLI, ikke et runtime-bibliotek, men står i `dependencies` og trækker et stort dependency-træ ind i produktions-install. Tilsvarende er både `playwright` og `@playwright/test` i devDependencies (dubleret), og `eslint`/`eslint-config-next` beholdes selvom Biome er linteren.
**Sted:** package.json (dependencies.shadcn; devDependencies.playwright/eslint)
**Alvorlighed:** low
**Forslag:** Flyt `shadcn` til devDependencies (eller brug `npx shadcn`); fjern `playwright` (kun `@playwright/test` behøves) og eslint-parret.

## [PASS3] Garmin-webhook-secret transporteres i query-strengen
**Beskrivelse:** Webhook-autentificering accepterer `?token=<GARMIN_WEBHOOK_SECRET>` i URL'en (Garmins portal tillader kun URL-registrering). Query-strenge lander i access-logs, proxy-logs og fejlrapporterings-breadcrumbs — koden dokumenterer selv risikoen, men der er ingen kompenserende kontrol (ingen rotation, ingen log-scrubbing). En lækket URL giver mulighed for at injicere falske aktiviteter og trigge deregistrering (sletning af brugeres Garmin-tokens via `deregistrations`).
**Sted:** app/api/garmin/webhook/route.ts:50-67 (verifyToken), 150-153 (deregistrations)
**Alvorlighed:** low
**Forslag:** Rotér secret regelmæssigt, scrub `token`-parametren i log-drains, og overvej at kræve at deregistrations kun fjerner tokens hvis Garmin-API'et bekræfter revokeringen.

## [PASS3] Token-refresh uden lås — race kan efterlade døde Garmin-tokens
**Beskrivelse:** `withTokenRefresh` (Strava) og `withGarminTokenRefresh` har ingen serialisering: to samtidige kald (fx webhook-fanout + manuel sync) kan begge se et udløbet token og begge fyre en refresh. Garmin roterer refresh-tokens, så den langsomste writer kan persistere et allerede-forbrugt refresh-token — næste refresh fejler permanent og brugeren skal re-autorisere. Webhook-upserts har advisory locks, men token-refresh-stien har ikke.
**Sted:** lib/garmin/client.ts:132-158, lib/strava/client.ts:33-77
**Alvorlighed:** low
**Forslag:** Tag en pg_advisory_xact_lock på userId omkring refresh+persist, eller re-læs rækken efter lås og spring refresh over hvis en anden allerede har fornyet.

## [PASS3] Chat: klient-leverede "assistant"-beskeder accepteres som kontekst
**Beskrivelse:** `chatMessageSchema` tillader `role: "assistant"` fra klienten. Når brugeren ingen DB-historik har (ny bruger, eller DB-læs fejler best-effort), sendes hele det klient-leverede transcript — inkl. fabrikerede assistant-turns — som modelkontekst. Det giver en autentificeret bruger en prompt-injection-kanal ("coachen har allerede sagt X"). Impact er begrænset (alle tools er read-only og bundet til brugerens eget userId), men fabrikerede svar persisteres ikke, mens de stadig kan farve svar der gemmes i historikken.
**Sted:** app/api/ai/chat/route.ts:62-65, 366-370
**Alvorlighed:** low
**Forslag:** Ignorér klientens assistant-beskeder (rekonstruér kun fra DB) eller markér dem eksplicit som upålidelige i konteksten.
