# Beslutningsdokument: wow-faktor uden LLM (issue #293)

**Til:** Benjamin (produktejer + portfolio-ejer)
**Status:** research — anbefaling, ingen kode
**Relaterede issues:** #292 (fjernede LLM-leddet), #293 (denne)

---

## Kort konklusion

Der findes en god, byggbar retning, og den kræver ingen ny datakilde, ingen model og ingen betalte tjenester.

Byg **wow-faktoren på to ting, i denne rækkefølge:**

1. **"Hvorfor dette pas"** — gør den regel-motor der allerede afgør dagens træning gennemsigtig: vis hvilke regler der udløste anbefalingen, og hvilke den afviste. ~1–2 dages arbejde. Motoren ligger der allerede; det er mest at eksponere den.
2. **Race-simulatoren** — gør den eksisterende race-prediktor interaktiv: træk i ugentlig volumen og mål-pace, og se race-estimatet og pace-grid'en flytte sig. ~2–3 dage. Prediktoren ligger der allerede (`predictRace`); det er en fremskrivnings-funktion plus UI.

Det er ikke "en LLM i forklædning". Det er et interaktivt, forklarligt værktøj bygget på aritmetik over løberens egne tal — hvilket er præcis det, et portfolio-projekt kan sælge, når det ikke må sælge "AI".

Det jeg **ikke** anbefaler, og hvorfor, står i afsnit e og f. Den vigtigste ærlige pointe: en stor del af den "wow" folk forbinder med AI er sproglig flydende prosa. Den kan Stride ikke lovligt genskabe på Strava-data. Wow'en skal derfor komme fra **interaktion og forklarlighed**, ikke fra formuleringsevne. Hvis du forventer at erstatningen skal *lyde* som en chatbot, findes den ikke — og så skal vi ikke bygge en.

---

## a) Problemformulering — hvad #292 efterlod

#292 fjernede alt der sendte Strava-data til en model, fordi Strava API Policy 2026 §5.3 forbyder det. To huller stod tilbage:

**Hul 1 — coach-chatten er væk uden ækvivalent.** `ChatPanel`, `/api/ai/chat`, `actions/chat.ts` og `types/chat.ts` er slettet. Der er i dag *ingen* fri-tekst-dialog med coachen. Det betyder ikke at coachen er tavs — coach-feedet på `/dashboard/coach` kører stadig og udfyldes af den deterministiske motor (se afsnit b). Men en besøgende der husker "man kunne spørge coachen om noget" møder nu et feed, ikke en samtale.

**Hul 2 — copyen lovede AI.** Det er allerede rettet. Issue-teksten (skrevet før #292 merged) peger på `README.md:7,17,58`; i dag står der i README: *"coaches from a deterministic rule engine. Every insight is arithmetic over the athlete's own runs — no model call, no key, no data leaving the server."* Der ligger **intet** "AI-powered"/"generative AI" tilbage i README. Det eneste tilbageværende AI-ord er `docs/architecture.md`'s titel, *"AI-Powered Running Training Dashboard"* — og filen er eksplicit markeret som historisk, ikke autoritativ. Ruten `/api/ai/analyze` hedder stadig "ai", men er deterministisk og har ingen provider. **Konklusion: copy-hullet er reelt lukket; det er chatten der mangler en efterfølger.**

**Hvorfor det er et reelt problem for porteføljen.** Stride skal skille sig ud som et *personligt* projekt. Med chatten væk er den mest "levende" flade appen har, et kort-feed der ligner et dashboard. Et dashboard er nemt at kopiere i et screenshot; en *forklarlig motor* og et *interaktivt "hvad hvis"* er sværere at kopiere og viser ingeniør-håndværk frem. Det er den historie der er tilbage at sælge — og den er faktisk stærkere end "vi kalder en model".

---

## b) Hvad der findes i dag (kun det jeg selv har verificeret i koden)

Alt nedenstående er læst i worktree'en `stride-293` på `main @ c18d22a`. Ingen påstand uden at filen er åbnet.

**Den deterministiske motor (er hele produktet nu):**

- `lib/coach/engine.ts` — faserne (adapt→burn→sharpen→peak→taper), `buildPhases`, `getWeekPlan`, `getCurrentPhase`, og et **constraint-system**: `ALL_CONSTRAINTS`, `getActiveConstraints`, `validateWorkout`. Hver constraint har en `description`, og hvert `ValidationIssue` bærer `message` + en valgfri `suggestion`. Der er tunables som `MIN_RECOVERY_HOURS = 48`, `EASY_MIN_RECOVERY_HOURS = 24`, `MAX_WEEKLY_INCREASE_RATIO = 1.1`. Fuldstændig ren/pure funktion.
- `lib/coach/recommender.ts` — `recommendWorkout(input, now)`, `weekToDateDistanceKm`, `PACE_RANGES`. Svarer på "det rigtige pas i dag".
- `lib/coach/next-activity.ts` — `buildNextActivity`, `avoidPlanDuplicate`. Svarer på "hvilken *slags* pas mangler de sidste fem ture". Kilder sidens egen kommentar: ren og deterministisk, ur og planlagt pas er parametre.
- `lib/training/progression-core.ts` — `computeSnapshot`/`computeProgression`. Beregner acute:chronic load som EWMA (`TAU_ACUTE = 7`, `TAU_CHRONIC = 42`), `TrainingLoad.ratio`, og en risikobånd-funktion `classifyRisk`: `detraining` < 0.8, `optimal` ≤ 1.3, `elevated` ≤ 1.5, `high` derover. Også `paceEfficiency`, `hrStability`, `zone2Percent`, `volumeKm`, `readyToIncrease`.
- `lib/training/prediction.ts` — `predictRace(...)`: Riegels model `T = T₁ × (D₂/D₁)^1.06` med en HR-baseret effort-rabat der kun må *sænke* estimatet, et `confidence`-felt (`low`/`medium`/`high`), og en "never guess"-regel: kan den ikke predikere, returnerer den en `reason` + en dansk `message` + hvilken distance der ville låse estimatet op. `zonePaces(prediction)` udleder hele pace-ladderen (recovery > easy > long > tempo > interval). `goalTimeFor` runder op til et rundt måltal.
- `lib/training/personal-record.ts` — `detectPersonalRecord(latest, history)`: PR pr. distancebånd (5k/10k/halv + længste tur).
- `lib/training/effort.ts` — `dominantZone`, `isHardEffort`, `hoursSinceHardEffort`.
- `lib/cobalt/readiness.ts` — `readinessFromRatio` + `readinessWithRecovery`. Én asymmetrisk mapping (fuldt bånd 0,8–1,15, blød straf under, stejl over), `pct` klemt til 55–95, `BAND_NOTES` delt på tværs af alle flader.
- `lib/cobalt/race-estimate.ts` — `estimateRaceTime`, `goalTimeFromEstimate`, `racePaceFromEstimate`.

**Analyse + blok-kontrakt (det gamle model-lag, nu rent deterministisk):**

- `lib/ai/analysis.ts` — `buildAnalysisInput` reducerer aktiviteter til et kompakt, afrundet summary; `heuristicBlocks` producerer de typede blokke ved ren aritmetik; `coachInsightBlock` giver coach-beskeden (risiko-advarsel > volumen-milepæl > headroom), men **returnerer `null` under 4 ugers historik** ("never guess").
- `lib/ai/tools.ts` — blok-kontrakten i zod: `analysisBlockSchema` er en discriminated union af `insightCard`, `trendCallout`, `workoutRecommendation`, `metricComparison`, `coachInsight`. Denne kontrakt bruges af både den heuristiske producent og af UI'et.
- `components/cobalt/coach-dashboard/CoachFeed.tsx` — "use client"-feedet der POST'er til `/api/ai/analyze`, læser NDJSON-streamen linje for linje og renderer hver valideret blok som et Cobalt Glass-kort. `parseFeedLine` dropper ugyldige linjer, så kun validerede blokke vises.
- `app/api/ai/analyze/route.ts` — den eneste tilbageværende "ai"-navngivne rute. Deterministisk NDJSON-stream, ingen provider, ingen cache, intet sessionskrav. Per-IP-rate-limit (30/60 s) og et anonymt payload-loft (100 aktiviteter).

**Datakilder (vigtigt for hele beslutningen):**

- Den **eneste** synkroniseringsvej er Strava. Der findes intet Garmin-, Apple Health-, Polar-, Suunto-, COROS- eller Wahoo-integrationslag, og **ingen** FIT/GPX/CSV-import. `lib/strava/` indeholder `client.ts`, `mappers.ts`, `oauth.ts`, `sync.ts`, `types.ts`. `app/api/strava/` har `callback`, `sync`, `webhook`.
- `activities`-tabellen har allerede en `source`-kolonne (`default("strava")`) og UI'et har en `SourceBadge` via `sourceOf()` (`lib/cobalt/hjem.ts:347`) — dvs. datamodellen er gjort kilde-agnostisk, men der er kun én kilde i praksis.
- Dine reads i analysen filtrerer kun på `userId`, aldrig på `source` (`lib/ai/analysis.ts` dokumenterer det eksplicit) — motoren ser alle ture uanset oprindelse.

**Demo-mode:** `lib/demo/data.ts` har 30 deterministiske aktiviteter (eksplicit ingen `Math.random`, så SSR og hydration er enige). De er fallback for indloggede uden synkede ture og driver `/demo` og landing-widgets.

**Verificeret fravær af features** (så vi ikke gentager dem): der findes **ingen** sæson-"wrapped"-opsummering, **ingen** delbart-kort-eksport/`navigator.share`, og **ingen** what-if-simulator i repoet. `mergeGoalGrid` i `lib/cobalt/plan.ts` er det tætteste vi kommer på "hvad hvis": den fletter et mål-ankret pace-grid ind i et prediktions-ankret, men den er statisk, ikke interaktiv. `app/opengraph-image.tsx` bruger allerede Next's `ImageResponse` til et statisk delbart socialt kort for *sitet* — det mønster kan genbruges til bruger-kort, men er ikke gjort.

---

## c) Den hårde grænse — og hvorfor de forbudte veje er forbudte

Den operative regel er Strava API Policy 2026, **§5.3** (hentet verbatim fra den primære kilde):

> "You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application. This prohibition extends to: Any data derived from, aggregated from, anonymized from, or generated using Strava Data, in any form (including original, derivative, aggregated, anonymized, de-identified, or model-output form); and Any of the following activities with respect to an AI Application: training, pre-training, post-training, fine-tuning, reinforcement learning, alignment, grounding, evaluation, benchmarking, embedding generation, retrieval-augmented generation, ingestion into a context window or working memory, and any other activity intended or reasonably likely to develop, improve, evaluate, or operate an AI Application."
> — <https://www.strava.com/legal/api_policy>

Plus **§5.10**: *"You may not … transfer or disclose Strava Data … to any third party — including advertisers, data brokers, AI Application providers, or model developers — even if a user of your Developer Application consents."* Og **§5.16(b)**: *"you may not … operate any MCP Server, agent-mediated interface, or analogous mechanism that exposes the Strava API Materials, Strava Data, or any subset thereof."*

Fire ting i §5.3 er afgørende, og de er grunden til at "smart" ikke redder nogen af nedenstående:

1. Ordet **"indirectly"** — mellemled er dækket, uanset hvor mange led der er imellem.
2. **"derived from … or generated using Strava Data, in any form"** — det Strides *egen* motor regner ud, er stadig Strava-data juridisk set.
3. **"evaluation"** og **"operation"** er navngivet — ikke kun træning. Inferens er "operation of an AI Application".
4. **"ingestion into a context window or working memory"** er navngivet eksplicit — det er præcis dét et prompt er.

Derfor forkastes følgende som løsninger, hver med sin grund:

- **Lille/lokal ML-model eller on-device inferens.** §5.3 dækker "operation of any AI Application" og "evaluation" uanset hvor modellen kører, og uanset at inferensen sker på brugerens enhed. "Lokalt" er ikke et smuthul — datastrømmen er den samme afledte Strava-data. **Afvist.**
- **Klassifikator, embedding eller "AI-lignende" trænet/evalueret scorer.** "embedding generation" og "evaluation" er navngivet direkte i §5.3. Selv en lille håndlavet scorer der *evalueres* som en model er dækket, og et embedding *er* per definition navngivet. **Afvist.**
- **"Modellen får kun motorens færdigregnede output."** §5.3 forbyder eksplicit "ingestion into a context window or working memory" og udvider til "any data derived from … or generated using Strava Data". Motorens output *er* afledt Strava-data. Mængden eller forarbejdningen ændrer intet. **Afvist.**
- **At proxy'e Stravas egen MCP.** §5.16(b) forbyder Stride at *drive* "any MCP Server, agent-mediated interface, or analogous mechanism that exposes Strava Data". §3.5 siger det samme fra den anden side: kun *abonnenten selv* må bringe *sin egen* AI-klient til Stravas MCP for *sin egen* personlige brug, og MCP'en er "not authorized for, and may not be used to enable, any commercial or third-party access". At Stride stod imellem brugeren og MCP'en ville være en §5.16(b)-overtrædelse. **Afvist.**
- **Enhver ny hostet AI-API, uanset leverandør.** §5.3 forbyder "operation" via enhver AI Application, og §5.10 forbyder videregivelse til "AI Application providers … even if a user … consents". Det er ikke en leverandørafhængig regel. **Afvist.**

**Hvad en gyldig løsning derfor kan være:** enten (a) **deterministisk/statistisk uden model** der regner på løberens egne aktiviteter, eller (b) en **helt anden datakilde** end Strava. Alt i denne anbefaling ligger i kategori (a). Kategori (b) er undersøgt og afvist *nu* i afsnit f.

**En ekstra grænse værd at kende (§5.4, §5.5).** §5.4 forbyder at *processe eller videregive* Strava-data — også aggregeret, de-identificeret eller anonymiseret — **"for the purposes of analytics, analyses, customer insight generation, or product or service improvements"**, og udvider til "data derived from Strava Data and to output that incorporates or was generated using Strava Data". §5.5 forbyder at gemme Strava-data "in any Persistent Index" (vektorlagre, embeddinglagre, søgeindeks, arkiver); kun den 7-dages transiente cache i §6.2 er tilladt.

Det betyder konkret for alle nedennævnte kandidater: at vise en løber **sine egne** tal tilbage til **sig selv** som appens kerneformål er den tilladte brug — det er hvad hele motoren allerede gør. Men to ting er forbudte fælder:

- At bruge dataene til **indsigter om brugerne/produktet** (fx "hvad lærer vi af alle løberes uger") eller til produktforbedring. Det er §5.4's kerneforbud.
- At gemme afledte tal i noget der er bygget til **senere opslag** (et indeks, et arkiv). Det er §5.5's kerneforbud. Beregn ved behov, eller hold dig inden for den transiente 7-dages-cache.

Ingen af kandidaterne nedenfor kræver at krydse de to linjer — men de skal bygges sådan at de ikke gør det ved et uheld.

---

## d) Kandidater til erstatning

Hver med: hvad det er, datakilde, deterministisk?, kompleksitet, wow, risici, omfang. Dagoverslag er *udviklerdage* for dig selv, inkl. tests.

### Kandidat 1 — Interaktiv race-simulator ("hvad hvis jeg …")

**Hvad.** Plan-siden får en lille kontrol: ugentlig volumen (slider) og mål-pace/tid (input). Appen fremskriver løberens nuværende fundament et antal uger og viser hvordan race-estimatet og pace-ladderen flytter sig. Ikke en ny model — Riegels fremskrivning (`predictRace`) kørt på en *hypotetisk* aktivitetsmængde, med det eksisterende `confidence`-felt synligt som usikkerhed.

**Datakilde.** Løberens egne Strava-aktiviteter, allerede i DB. Ingen ny kilde.

**Deterministisk.** Ja — ren aritmetik, `now` injiceret.

**Kompleksitet.** Lav-mellem. `predictRace` + `zonePaces` findes; der mangler en fremskrivnings-funktion (fx "giv mig estimatet hvis uge-volumen ændres med X og mål-pacen er Y") og et UI med 2–3 kontroller. Ingen ny tabel, intet gemt.

**Wow.** Mellem-høj. Det er interaktivt, det svarer på det spørgsmål enhver løber stiller ("kan jeg nå under 1:40?"), og det er et konkret tal der bevæger sig. God portfolio-demo.

**Risici.** En simulator kan *love* mere end data bærer. Skal vise usikkerhed (brug `confidence`, ikke en falsk præcision), og bør ikke gemme forudsigelserne. Kultur-fælde: hvis den lyder som et orakel, bliver det et løfte.

**Omfang.** ~2–3 dage.

### Kandidat 2 — "Hvorfor dette pas" — regelspor for motoren

**Hvad.** Hver anbefaling og validering får et synligt, maskinelt genereret spor: hvilke constraints blev evalueret, hvilke udløste en blokering/advarsel, og hvad motoren *afviste* og hvorfor. Constraint-systemet bærer allerede `description` og `ValidationIssue.suggestion`; det handler om at eksponere dem i Cobalt Glass-sprog i stedet for at skjule dem i motoren.

**Datakilde.** Løberens egne aktiviteter + regeldefinitionerne i koden. Ingen ny kilde.

**Deterministisk.** Ja.

**Kompleksitet.** Lav. Reglerne, ID'er og beskederne findes. Arbejdet er primært: oversæt `description`/`suggestion` til korte, gode danske sætninger én gang, eksponér dem som en blok i `lib/ai/tools.ts`-kontrakten, render dem i `CoachFeed`/kortet. Intet nyt arkitektur-lag.

**Wow.** Mellem. Det gør en "black box" til en gennemsigtig motor — "du kan se *præcis* hvorfor coachen siger det". Det er sjældnere i træningsapps end endnu et dashboard, og det er en stærk ingeniør-historie for et portfolio.

**Risici.** Kan blive tørt/teknisk hvis copy'en ikke redigeres. Kræver at *du* skriver god dansk én gang for alle — der er ingen model til at glatte ud. Det er også en §5.4-nær flade: eksponér *denne* løbers *eget* pas, ikke generelle mønstre.

**Omfang.** ~1–2 dage.

### Kandidat 3 — Ugentlig "træningsbrev"-rapport på naturligt dansk (template-baseret)

**Hvad.** En ugentlig opsummering sat sammen af deterministiske skabeloner med variabel-fletning: uge-volumen, ACWR-bånd, PR, næste uges fokus, i en sammenhængende dansk tekst uden model.

**Datakilde.** Egne aktiviteter.

**Deterministisk.** Ja.

**Kompleksitet.** Lav-mellem.

**Wow.** **Lav-mellem — og ærligt: svag.** Coach-feedet producerer allerede de samme kort. Det nye er kun at samle dem til prosa, og prosa er netop dét et template gør dårligst. Den marginale wow over det eksisterende feed er lille.

**Risici.** To. (1) Det lyder let som et formularbrev. (2) §5.4 fælden: hvis "brevet" bruges til *indsigter om* brugeren eller produktet, er det forbudt; kun den enkeltes egen uge må vises.

**Omfang.** ~1–2 dage.

**Vurdering: ikke anbefalet som hovedspor.** For tæt på det der findes.

### Kandidat 4 — Delbart løbe-/sæsonkort som statisk billede

**Hvad.** Generér et delbart PNG-kort (PR, uge, race-estimat) via Next's `ImageResponse`. Mønsteret findes allerede i `app/opengraph-image.tsx`.

**Datakilde.** Egne aktiviteter.

**Deterministisk.** Ja.

**Kompleksitet.** Lav-mellem.

**Wow.** Høj for portfolio — synligt, delbart, visuelt. Det er den slags der bliver screenshottet.

**Risici.** Strava har egne **brand-/attributionskrav** til hvordan Strava-data må vises/videresendes (Strava API Brand Guidelines). Jeg har **ikke verificeret** de præcise krav i denne opgave, så det kan ændre designet. §5.4 gælder også: at *vise* løberen sit eget kort er kerneformålet, men et "sæson-aggregeret" kort skal holdes som den enkeltes eget data, ikke som aggregeret statistik.

**Omfang.** ~2–3 dage (mere hvis brand-kravene kræver tilpasning).

### Kandidat 5 — Anden datakilde: manuel FIT/GPX/CSV-import

**Hvad.** En importvej hvor brugeren selv uploader en `.fit`/`.gpx`/`.csv`. Så er dataene *ikke* Strava-data, og §5.3/§5.10/§5.16 gælder dem ikke — på den vej kunne man i princippet endda genindføre en model.

**Datakilde.** Brugerens egne filer. Ikke Strava.

**Deterministisk.** Ikke relevant — det er en datakilde, ikke en feature.

**Kompleksitet.** **Høj.** FIT-parsing i TypeScript, upload-UI, dedup mod Strava-synken, og en klar adskillelse af de to kildestrømme så man kan hævde at AI-forbuddet ikke gælder det importerede. `source`-kolonnen findes, men alt omkring den er nyt.

**Wow.** Høj, *hvis* målet er "vær ikke bundet til Strava". Men det er en arkitektur- og forretningsbeslutning, ikke en wow-faktor.

**Risici.** Stor overflade og en varig vedligeholdelsesbyrde. Så længe Strava er hovedvejen (og det er den), blander man to kilder og skal holde dem adskilt. At bygge dette for at "få lov til AI igen" på en bagvej er ikke en wow-strategi.

**Omfang.** ~2–3 uger (forsigtigt estimat).

**Vurdering: ikke nu.** Forkert rækkefølge — se afsnit f.

### Kandidat 6 (undersøgt og afvist) — andre wearables som datakilde

Kort, fordi det var issueets eget spor 1, og svaret er et klart "ikke nu":

- **Garmin Connect.** Deres egne Developer API Brand Guidelines kræver Garmin-attribution når Garmin-data bruges "as an input to analytics, algorithms, machine learning models, artificial intelligence or combined, aggregated or blended with other sources" — dvs. de *tillader* AI med attribution, modsat Strava. **Men** Garmin har ifølge gentagne rapporter og Garmins eget forum **sat nye API-adgange på pause** (adgang er partner-godkendelse, ansøgningsformularen fjernet, ingen genåbningsdato). Kilde: <https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf> og Garmins eget forum. Dvs. ikke en vej man kan gå i morgen.
- **Apple Health (HealthKit).** Har ingen cloud-/server-API. Data læses *on-device* af brugerens egen app med brugerens tilladelse. Stride er en Next.js-webapp uden native iOS-app — det ville kræve at bygge og vedligeholde en native app før noget som helst kan læses. HealthKit-forbrug er derudover bundet af Apples retningslinjer. **Ikke verificeret i detaljen her.**
- **Polar (AccessLink), COROS, Wahoo, Suunto.** Der findes åbne udvikler-API'er af varierende modenhed, og AccessLink leverer efter sigende kun ny data, ikke historik. **Jeg har ikke verificeret disses AI-vilkår** i denne opgave — og issueets eget kvalitetskrav siger: hellere "ikke verificeret" end et gæt. **Ikke verificeret.**

Fælles for alle: de kræver **en helt ny integrations-, OAuth- og mapper-vej** for hver kilde, plus vedligeholdelse, for et projekt der i dag kører én kilde godt.

---

## e) Anbefalet retning

**Byg Kandidat 2 først, derefter Kandidat 1.** Ingen ny datakilde, ingen model, ingen betalt tjeneste, intet der krydser §5.3/§5.10/§5.16 eller §5.4/§5.5.

**Hvorfor Kandidat 2 + 1 og ikke de andre:**

- **Bedst wow pr. indsats.** Kandidat 2 er ~1–2 dage fordi motoren allerede bærer beskrivelserne; Kandidat 1 er ~2–3 dage fordi prediktoren allerede er skrevet. Tilsammen under en uge for et interaktivt, forklarligt produkt-øjeblik — det er svært at slå med nogen anden kandidat.
- **De bygger på det der *er* Stride, i stedet for at genopfinde det.** Issue #293 siger det selv: wow-arbejdet skal bygge oven på motoren, ikke genopfinde den. Disse to gør præcis det.
- **De er ægte wow, ikke et dashboard mere.** Et dashboard screenshot'es og glemmes. Et interaktivt "hvad hvis" og et synligt "her er *hvorfor*" er dét der får en besøgende til at prøve noget.
- **De er juridisk kedelige — på den gode måde.** Begge regner *kun* på løberens egne aktiviteter og viser *løberen selv* resultatet. Ingen ny datamodtager, intet kontekstvindue, intet gemt indeks. Ingen gråzone.

**Hvad jeg ville afvise, selv hvis du spørger "hvorfor ikke X?":**

- **"Hvorfor ikke lige en lille lokal model? Det er jo ikke en API."** Fordi §5.3 forbyder "operation of any AI Application" og "evaluation" uanset hvor det kører, og udtrykkeligt dækker data "derived from … Strava Data". "Lokalt" ændrer ikke datastrømmen.
- **"Hvorfor ikke bare lade motoren skrive prosa med skabeloner og kalde det en coach?"** Det er Kandidat 3, og svaret er: den marginale wow over det eksisterende feed er lille, og prosa er netop hvad en skabelon gør dårligst. Det ligner et plaster på chat-hullet, ikke en erstatning.
- **"Hvorfor ikke bygge FIT/GPX-import så vi kan få AI tilbage?"** Fordi det er 2–3 ugers arbejde for at slippe ud af et forbud som kerneproduktet allerede overholder. Det giver kun mening hvis du *vil* væk fra Strava — og det er en anden beslutning end denne.
- **"Hvorfor ikke skifte til Garmin? De tillader AI."** Fordi Garmin har sat nye API-adgange på pause, så du kan ikke engang komme ind.
- **"Hvorfor ikke et delbart sæson-kort? Det er da meget flottere."** Kandidat 4 er god, men den hviler på Strava brand-/attributionskrav jeg ikke har verificeret, og den er visuel pynt oven på det samme data — den er fase 2, ikke fundamentet.

**Kombinationen der gør det til en historie:** når begge er bygget, kan forsiden sige noget konkret og sandt, fx *"Du kan se præcis hvilke regler der udløste dagens pas — og trække i volumen og se dit race-estimat flytte sig."* Det er en sætning et dashboard ikke kan sige.

**Gør anbefalingen falsificerbar.** Denne anbefaling er forkert hvis: (a) det viser sig at Kandidat 2's regelspor ikke kan gøres forståeligt på dansk uden at lyde teknisk — så er wow'en væk og kun Kandidat 1 står; eller (b) den interaktive simulator i praksis bare bliver `predictRace` med et tal der ikke ændrer sig meningsfuldt for en 10K-løber — så er interaktionen en kulisse; eller (c) det viser sig at Strava-betragtningen af §5.4 tolkes så bredt at selv at *vise* løberen egne aggregerede tal anses for "analytics" — så skal hele "vis egne aggregater"-fladen revurderes. Ingen af de tre er sandsynlige ud fra den ordlyd jeg læste, men de er de observationer der ville gøre mig forkert.

---

## f) Hvad der IKKE bør gøres nu

- **Ingen ny hostet AI-API, nogen leverandør, nogen undskyldning.** §5.3 forbyder "operation"; §5.10 forbyder videregivelse "even if a user consents". Det er ikke et spørgsmål om hvilken leverandør.
- **Ingen lokal/on-device ML, ingen klassifikator, intet embedding, ingen evalueret heuristisk scorer.** Navngivet i §5.3.
- **Ingen proxy af Stravas MCP.** §5.16(b) forbyder Stride at drive agent-interfacet; §3.5 tillader kun brugerens *egen* klient til *egen* personlig brug.
- **Ingen ny betalt tjeneste.** Du er på Vercel hobby og har sagt nej til betalte tjenester. Alle anbefalede kandidater kører på det der allerede er.
- **Ingen FIT/GPX-import nu.** 2–3 uger, og kun relevant hvis du vil væk fra Strava — en anden beslutning.
- **Ingen ny wearable-datakilde nu.** Garmin-adgang er på pause; Apple Health kræver en native app en webapp ikke har; Polar/COROS/Wahoo/Suunto er uvurderede (ikke verificerede) og koster hver sin helt nye integrationsvej.
- **Byg ikke et "sæson-aggregat" der fortæller noget om brugerne eller produktet.** §5.4 forbyder Strava-data i aggregeret/de-identificeret form "for the purposes of analytics, analyses, customer insight generation, or product or service improvements". Vis kun løberen hans *eget*.
- **Gem ikke afledte tal i noget der er bygget til senere opslag.** §5.5 forbyder Strava-data i "any Persistent Index"; kun den transiente 7-dages-cache i §6.2 er tilladt. Beregn ved behov.
- **Byg ikke en fuzzy efterligning af chat-prosa bare fordi chatten manglede.** Det er ikke det produktet kan love, og det ville oversælge.

---

## g) Hvad #292 allerede ryddede væk (så du slipper for at læse hele #292)

**Slettet, og må ikke genindføres** (kilde: `AGENTS.md` + verificeret fravær i koden):

- Model-lag: `lib/ai/provider.ts`, `lib/ai/harmony.ts`, `lib/ai/coach-tools.ts`.
- Chat: `app/api/ai/chat/`, `actions/chat.ts`, `components/cobalt/coach/ChatPanel.tsx` (plus `MessageBubble`, `ChatMarkdown`, `ActivityCard`), `lib/cobalt/chat-markdown.ts`, `types/chat.ts`.
- Databasetabeller (droppet i `drizzle/migrations/0009_*`): `chat_messages`, `ai_analyses`, `activity_embeddings`.

**Beholdt — og det er hele produktet nu:**

- `lib/coach/*` (regelmotor + recommender + next-activity), `lib/training/*` (progression, ACWR, pace-efficiency, zoner, PR, race-prediktor), `lib/cobalt/readiness.ts`.
- `lib/ai/analysis.ts` (`buildAnalysisInput` + `heuristicBlocks`), `lib/ai/tools.ts` (blok-kontrakten), `app/api/ai/analyze/route.ts` (deterministisk NDJSON-stream).

**Copy-status:** README lover ikke længere AI (verificeret). Eneste resterende AI-ord er `docs/architecture.md`'s titel, som er markeret historisk. Ruten `/api/ai/analyze` hedder stadig "ai", men er deterministisk og har ingen provider. Eventuelle portfolio-afsmitninger ligger i et **separat** repo — jeg har ikke rettet dem her.

---

## Kilder (verificerede) og hvad der er uafklaret

**Verificerede primærkilder:**

- Strava API Policy 2026 — §5.3, §5.4, §5.5, §5.10, §5.16(b), §3.5: <https://www.strava.com/legal/api_policy> (hentet verbatim; citaterne i afsnit c er ordrette).
- Garmin Developer API Brand Guidelines (attribution ved bl.a. AI/ML-brug): <https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf>

**Ikke verificeret i denne opgave** (issueet kræver citat+URL før det må bruges som grundlag — disse må ikke bruges i copy før de er efterprøvet):

- Garmins præcise AI-vilkår i selve Developer Program Agreement (jeg har kun brand-guidelines + presserapporter om pause).
- Apples HealthKit-vilkår i detaljen (kun at der ikke findes en cloud-API og at data læses on-device).
- Polar AccessLink, COROS, Wahoo og Suunto — alle "ikke verificeret".

**Åbne spørgsmål til dig:**

1. Er wow-målet "flere besøgende prøver noget" eller "flere *husker* Stride"? Det flytter vægten fra Kandidat 1 (interaktion) mod Kandidat 4 (delbart kort).
2. Skal chat-hullet overhovedet lukkes, eller er det accepteret at coachen er et *feed og en plan*, ikke en samtale? Min anbefaling antager det sidste — og det er en helt fin produktbeslutning.
3. Strava brand/-display-kravene (for Kandidat 4) skal efterprøves mod den primære tekst før et delbart kort bygges.
