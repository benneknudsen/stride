# Tilgængelighed

Denne case beskriver arbejdet med tilgængelighed i Stride og de grænser, der
stadig er. Målingerne er foretaget 2026-11-06 med axe 4.14, WCAG A/AA, ved
mobil 390×844 via `npm run test:a11y` (collect-only; orkestratoren tæller
overtrædelserne fra JSON-filerne).

## Før og efter

Antal `color-contrast`-overtrædelser (serious) pr. side:

| Side | Før T5 | Efter T5 |
| --- | ---: | ---: |
| `/` | 4 | 0 |
| `/demo` | 7 | 0 |
| `/aktiviteter` | 9 | 0 |
| `/plan` | 4 | 0 |
| `/dashboard/coach` | 31 | 0 |
| `/login` | 1 | 1 |

Efter T5 er der 0 på alle sider undtagen `/login`, hvor den ene overtrædelse
står tilbage.

## Tekniske tiltag

Arbejdet er samlet i `app/globals.css` og ændrer ikke brandfarverne som sådan.
To nye tokens blev indført:

- `--color-red-ink: #bd251b` — rød tekst og fill på lys flade, hvor der kræves
  4,5:1 (`app/globals.css:239`).
- `--color-strava-deep: #c93a00` — Strava-CTA med hvid tekst, 5,14:1
  (`app/globals.css:247`).

Den originale brand-rød (`--color-red`) og Strava-orange (`--color-strava`)
ligger uændret (`app/globals.css:238`, `app/globals.css:246`). Ændringen er
altså, at tekst og fill, der skal bære kontrast, bruger de mørkere varianter,
mens brandfelterne beholder deres farve.

Derudover blev dæmpede tekstfarver som `text-ink/60`, `text-ink/70` og
`text-ink/80` erstattet med fuld `text-ink`, så teksten holder mindst 4,5:1 på
silver- og glasflader.

## Kendte begrænsninger

- **Strava-brandknappen på `/login`.** Hvid tekst på `#fc4c02` giver 3,4:1 og
  består ikke AA for normal tekst. Knappen er tredjepartens brandflade, og jeg
  har accepteret den som en kendt begrænsning uden at ændre Strava-brandet.
  Det er den ene resterende overtrædelse i tabellen.
- **Fuld ink over gradient-blobs.** På flader med 15%-gradient-blobs måler axe
  ikke gradienten. I en kantzone ligger den reelle kontrast omkring 3,7:1. Det
  er en vurderet begrænsning, ikke en målt sejr; jeg nævner den, fordi axe-tallet
  alene ville være misvisende.

## Andre tilgængelighedsforhold

- **`FlipText`.** Den visuelle tekst er `aria-hidden`, og en `sr-only`-søskende
  bærer hele sætningen som én streng (`components/cobalt/FlipText.tsx:287`), så
  skærmlæsere ikke læser de animerede bogstaver stykvis.
- **Loader.** Loaderen har `role="status"` og `aria-live="polite"`
  (`components/cobalt/RunnerLoader.tsx:24-25`). E2e-hjælperne tæller dem ned,
  inden de går videre, så testen venter på, at indholdet er klart.
- **Mobil tab-bar.** `BottomTabBar` er `md:hidden` (`components/cobalt/BottomTabBar.tsx:92`)
  og har en stor tap-zone.
- **Keyboard og fokus.** Interaktive elementer er knapper og links med synlig
  fokusorden; der er ingen klikbare `div`-er i de centrale flows.
- **Reduced motion.** Med `prefers-reduced-motion` sættes varigheden til 0, og
  alt indhold vises med det samme. Nav-pill-testen bekræfter, at den er synlig
  med det samme og aldrig skjuler sig (`__tests__/cobalt/nav-pill.test.tsx:163`).
  T6-login bruger transform-only bevægelse.

Jeg har ikke jagtet et perfekt axe-tal. Jeg har fjernet de kontrastfejl, der
kunne fjernes uden at ændre brandet, og skrevet de to resterende begrænsninger
ned, så de ikke ser ud som upåagtede fejl.
