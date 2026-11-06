# Typed block-stream

Dette dokument beskriver en arkitekturbeslutning i Stride: analyseresultatet
sendes ikke som én stor tekst- eller JSON-respons, men som en strøm af små,
typiserede blokke. Hver blok valideres ved grænsen og renderes først derefter.

## Problemet

Coach-feedet skal vise indsigter, trends, sammenligninger og et løbsreview. Den
oprindelige fare er den klassiske: en komponent modtager fri tekst eller et løst
JSON-objekt og renderer det. Så kan UI'et påstå ting, som motoren ikke har
udledt, eller en komponent vælter på et felt, der mangler.

Jeg ville have en kontrakt, hvor motoren er den eneste, der kan producere
indhold, og hvor UI'et kun kan vise det, kontrakten tillader.

## Løsningen

Motoren reducerer først aktiviteterne til et kompakt resumé
(`buildAnalysisInput`) og udleder derfra et sæt blokke med aritmetik
(`heuristicBlocks`). `app/api/ai/analyze/route.ts:1-13` beskriver præcis denne
vej: intet modelkald, ingen provider.

Kontrakten ligger i `lib/ai/tools.ts`. Filens indledning kalder schemas for
"the contract between the analysis engine and the UI" og siger, at hvert tools
input-schema er "the single source of truth: it drives the runtime validation
and the React component props" (`lib/ai/tools.ts:1-8`). Blokkene er en
diskrimineret union over navngivne typer — `insightCard`, `trendCallout`,
`workoutRecommendation`, `metricComparison`, `coachInsight` og `runReview`
(`lib/ai/tools.ts:146-153`). Fælles enums som `sentiment`,
`trendDirection`, `coachInsightType` og `sessionRisk` er også defineret her
(`lib/ai/tools.ts:20-29`).

Ved grænsen valideres hver blok. `toolCallToBlock` kalder
`analysisBlockSchema.safeParse(candidate)` og returnerer `null`, hvis den ikke
består (`lib/ai/tools.ts:176-183`, selve kaldet på linje 181). Samme mønster
bruges i routen: hver blok fra `heuristicBlocks` safeParses, før den når
streamen, og kun `validated.data` pushes (`app/api/ai/analyze/route.ts:178-184`):

```ts
const validated = analysisBlockSchema.safeParse(block);
if (validated.success) blocks.push(validated.data);
```

Streamen er newline-delimited JSON. `NDJSON_HEADERS` sætter
`Content-Type: application/x-ndjson` og `Cache-Control: no-store`
(`app/api/ai/analyze/route.ts:113-116`), og `ndjsonResponse` enqueuer hver blok
som `JSON.stringify(block) + "\n"` (`app/api/ai/analyze/route.ts:119-130`). Der
ligger altså én valideret blok pr. linje.

På klienten parser `parseFeedLine` hver linje tilbage til en typed blok
(`lib/coach/feed.ts:67-83`). Den dropper blanke linjer, ugyldig JSON og shapes,
der fejler schemaet. `CoachFeed.tsx` læser strømmen chunk for chunk, deler på
newline og tilføjer blokke, efterhånden som de lander
(`components/cobalt/coach-dashboard/CoachFeed.tsx:208-229`). `BlockCard` vælger
den matchende komponent ud fra `block.tool`
(`components/cobalt/coach-dashboard/CoachFeed.tsx:153-168`). Kommentaren i
`lib/ai/tools.ts:8` siger det direkte: "a block that does not validate is simply
not rendered".

## Hvad det køber

- **Fejl kan ikke rendres.** En uvalid blok droppes ved grænsen og igen på
  klienten, før den når en komponent (`lib/ai/tools.ts:181`,
  `lib/coach/feed.ts:81-82`, `app/api/ai/analyze/route.ts:182`).
- **Kontrakten er typesikret.** Schemaet er både runtime-validering og grundlag
  for React-props (`lib/ai/tools.ts:6-8`). `AnalysisBlock` er udledt af Zod
  (`lib/ai/tools.ts:155`), og renderer-switchen er ekshaustiv: en ny variant
  fejler ved typecheck i stedet for at rendere tomt
  (`components/cobalt/coach-dashboard/CoachFeed.tsx:149-167`).
- **Streaming giver progressiv rendering.** Hver linje vises, så snart den
  ankommer, uden at vente på en samlet respons
  (`app/api/ai/analyze/route.ts:118-130`,
  `components/cobalt/coach-dashboard/CoachFeed.tsx:211-229`).
- **Ingen model i loopet.** Blokkene kommer fra aritmetik over brugerens egne
  tal (`app/api/ai/analyze/route.ts:8-13`), hvilket også er det, der gør
  resultatet reproducerbart og i overensstemmelse med Strava-policyen.

## Hvad det koster

- **Flere små dele pr. bloktype.** En ny blok kræver et schema i
  `lib/ai/tools.ts`, en gren i `feedCardView` eller `BlockCard` i
  `CoachFeed.tsx`, og typisk en dedikeret komponent. Kommentaren i
  `lib/ai/tools.ts:10-11` forklarer registreringen.
- **Et ekstra valideringsskridt.** Hver blok safeParses før streamen
  (`app/api/ai/analyze/route.ts:180-183`) og igen ved parse på klienten
  (`lib/coach/feed.ts:81`). Det er billigt, men det er kode, der skal vedligeholdes.
- **To steder skal opdateres i takt.** `lib/ai/tools.ts` og `CoachFeed.tsx`
  skal begge kende den nye type. Glemmer man renderer-grenen, fanges det af den
  ekshaustive switch; glemmer man schemaet, findes typen ikke.
- **Streaming-protokollen skal håndteres manuelt.** Klienten skal selv buffere,
  finde newlines og håndtere halvfyldte chunks (`lib/coach/feed.ts:67-70`,
  `components/cobalt/coach-dashboard/CoachFeed.tsx:217-229`). Det er mere kode
  end et enkelt `await res.json()`.

Jeg valgte denne vej, fordi den gør grænsen mellem motor og UI eksplicit.
Prisen er mere mekanik pr. bloktype; gevinsten er, at UI'et ikke kan vise noget,
kontrakten ikke har godkendt.
