# Redesign-spec: Stride — Cobalt Glass

> **Til Claude Code / Opus:** Denne fil er den komplette spec for Strides redesign.
> Filerne i `design-files/` er **HTML-designreferencer** (prototyper), ikke produktionskode.
> Opgaven er at **genskabe designet i den eksisterende Next.js-kodebase** med dens etablerede
> mønstre og biblioteker. Screenshots i `screenshots/` viser præcis, hvordan slutresultatet skal se ud.
> Designet er **high-fidelity**: farver, typografi, spacing og animationer skal følges pixel-nært.

---

## 1. Design tokens

### CSS-variabler

```css
:root {
  /* Farver — kerne */
  --cobalt:        #1B29C0;  /* primær brand, tekst, aktive states */
  --cobalt-light:  #2536D8;  /* gradient-top på logo-brik og knapper */
  --cobalt-dark:   #131F96;  /* gradient-bund */
  --red:           #EE2418;  /* accent: signal, zoner, logo-hoved, highlights */
  --silver:        #E9EAE5;  /* side-baggrund ("sølv-papir") */
  --silver-dark:   #DDE0EC;  /* gradient-variant af baggrund */
  --muted:         #5560A8;  /* sekundær tekst, labels, mono-tekst */

  /* Farver — semantiske */
  --success:       #2BA84A;  /* synced-prik */
  --success-text:  #1B7A38;  /* synced-tekst */
  --garmin:        #007CC3;  /* Garmin kilde-badge-prik */
  --strava:        #FC4C02;  /* Strava kilde-badge-prik + connect-knap */
  --on-red:        #FDF3EE;  /* tekst på røde flader */

  /* Glas (liquid glass-widgets) */
  --glass-bg:      rgba(255,255,255,0.42);
  --glass-border:  1px solid rgba(255,255,255,0.7);
  --glass-blur:    blur(24px);                    /* backdrop-filter */
  --glass-shadow:  0 8px 32px rgba(27,41,192,0.10), inset 0 1px 0 rgba(255,255,255,0.8);
  --glass-shadow-accent-red:    0 12px 36px rgba(238,36,24,0.28), inset 0 1px 0 rgba(255,255,255,0.5);
  --glass-shadow-accent-cobalt: 0 12px 36px rgba(27,41,192,0.35), inset 0 1px 0 rgba(255,255,255,0.3);

  /* Border-radius */
  --radius-widget: 24px;   /* store widgets */
  --radius-card:   20px;   /* mindre widgets/kort/nav */
  --radius-tile:   13px;   /* zone-brikker, logo-brik (34px), ikon-tiles */
  --radius-pill:   999px;  /* knapper, badges, chips, progress-bars */

  /* Spacing (base 4px-skala; hyppigst brugte) */
  --space-2: 8px;  --space-3: 12px;  --space-4: 16px;
  --space-5: 20px; --space-6: 24px;  --space-7: 28px;  --space-10: 40px;

  /* Sidelayout */
  --page-max-width: 1360px;
  --page-padding-x: 28px;
  --bento-gap: 16px;       /* grid gap mellem widgets */
  --widget-padding: 22px 26px;
}
```

### Tailwind config (uddrag)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        cobalt: { DEFAULT: '#1B29C0', light: '#2536D8', dark: '#131F96' },
        signal: '#EE2418',
        silver: { DEFAULT: '#E9EAE5', dark: '#DDE0EC' },
        muted: '#5560A8',
        onred: '#FDF3EE',
        garmin: '#007CC3',
        strava: '#FC4C02',
      },
      borderRadius: { widget: '24px', card: '20px', tile: '13px' },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'sans-serif'],   // store tal + titler
        serif:   ['"Instrument Serif"', 'serif'],            // heroes/citater, ALTID italic
        sans:    ['"Instrument Sans"', 'sans-serif'],        // brødtekst/UI
        mono:    ['"Spline Sans Mono"', 'monospace'],        // labels/data
      },
      backdropBlur: { glass: '24px' },
    },
  },
};
```

### Typografi-skala

| Rolle | Font | Vægt | Størrelse | Detaljer |
|---|---|---|---|---|
| Hero-tal (desktop) | Bricolage Grotesque | 800 | 80px | line-height 0.85, letter-spacing −0.04em |
| Hero-overskrift | Instrument Serif *italic* | 400 | 54px | line-height 1.02. Bruges SPARSOMT — kun hero + widget-overskrifter/citater |
| Widget-tal store | Bricolage Grotesque | 700–800 | 34–46px | letter-spacing −0.03em |
| Widget-overskrift (serif) | Instrument Serif *italic* | 400 | 22px | fx "Seneste ture", "Datakilder" |
| Kort-titel | Bricolage Grotesque | 700 | 30px | fx aktivitetsnavn |
| Brødtekst / rækker | Instrument Sans | 400–600 | 12–15px | |
| Mono-labels | Spline Sans Mono | 400–600 | 9–11px | ALTID uppercase + letter-spacing 0.14–0.22em |
| Wordmark "stride" | Bricolage Grotesque | 700 | 20px | lowercase, letter-spacing −0.03em |

Google Fonts-import: `Bricolage+Grotesque:opsz,wght@12..96,400..800`, `Instrument+Sans:wght@400;500;600`, `Instrument+Serif:ital@0;1`, `Spline+Sans+Mono:wght@400;500;600`.

### Baggrund ("liquid"-blobs)

Sidebaggrund `--silver` med 2–3 fixed, blurrede radial-gradient-cirkler bagved alt indhold
(rød øverst-højre, kobolt venstre, lys kobolt nederst). De driver langsomt (14–22s ease-in-out
loops, translate ±30px + scale 1.06). `pointer-events: none`.

---

## 2. Komponent-liste (ændringer pr. komponent)

| Komponent | Ændring | Detaljer |
|---|---|---|
| **Logo** | NYT | Løber-glyf: rødt cirkel-hoved + krop/ben i ét streg-forløb + 2 arme (55 % opacity). I nav: 34×34px brik, gradient `--cobalt-light`→`--cobalt-dark`, radius 11px, glyf i sølv. SVG'er i `assets/` |
| **Nav-bar** | NYT | Glas-pill (radius 20px, glass-tokens), sticky-agtig øverst. Links: Hjem (aktiv = kobolt pill m. sølv tekst), Aktiviteter, Coach (med 12px rød AI-gnist-stjerne foran), Plan. Højre: Sync-knap + "BENJAMIN" (mono) + 32px avatar-cirkel |
| **Sync-knap** | NYT | 3 states: `Sync now` (kobolt pill, hvid refresh-ikon) → `SYNCER…` (outline pill, pulserende rød prik, mono) → `SYNCED` (outline pill, grøn prik, grøn tekst). Simuleret 1,8s |
| **Hero** | NYT | Venstre: rød mono-label ("UGE 27 · MARATHONPLAN") + serif-italic hilsen i 2 linjer. Højre: kæmpe km-tal med count-up-animation (1,2s ease-out cubic) + mono-underlabel |
| **Plan-strip** | NYT | Slank glas-række: logo-tile + "CPH Marathon · mål 3:45" + progress-bar (71 %, kobolt→rød gradient i enden) + "74 DAGE" (rød mono) + "Se plan →" outline-knap |
| **Seneste aktivitet (widget, stor)** | NYT | 6/12 kolonner. Header: mono-label + GARMIN-badge + tidspunkt. Titel 30px + zone-pill ("Zone 3 · Moderat tempo"). 4 nøgletal (34px display, puls i rød). Pace-kurve: SVG-linje der tegner sig (stroke-dasharray, 1,8s) med pulserende rød endeprik |
| **Rute (widget, lille)** | NYT | 3/12 kolonner. Rigtigt kort: **Leaflet + CARTO light_all tiles**, ikke-interaktivt (alle handlers off). Rute som rød polyline (bred 22 %-opacity glow under 3,5px streg), start-prik kobolt, slut-prik rød. Stats-chip nederst-venstre i glas |
| **Snit-pace (widget)** | NYT | 3/12. Progress-ring (SVG-cirkel, stroke-dasharray-animation), 5:06 i display-font i midten, note med rød delta nederst |
| **Volumen (widget)** | NYT | 4/12. 10 søjler, stigende kobolt-opacity (0.25→1.0), sidste søjle rød. Vokser fra bunden staggered (delay 0.06s pr. søjle, scaleY cubic-bezier(.2,.8,.2,1)) |
| **Restitution (widget)** | ÆNDRET (mindre) | 3/12, kompakt. Rød gradient-flade (rgba(238,36,24,0.85→0.65)), 86 % i display-font, hvid progress-bar. Tekst i `--on-red` |
| **AI Coach (widget)** | NYT | 5/12. Kobolt-flade rgba(27,41,192,0.9). Logo-glyf + "AI COACH" mono + serif-italic citat i »…«. 2 pill-knapper (sølv solid + outline) |
| **Seneste ture (widget)** | ÆNDRET | 7/12. Rækker med: intensitets-måler (42px brik med 5 mini-søjler: kobolt = aktiv, rød = hård, 15 % = inaktiv — IKKE tal!), navn + dato + klartekst-zone ("Hårdt tempo" i rød / "Rolig snak-fart" i kobolt), kilde-badge (STRAVA/GARMIN med farvet prik), km + pace højrestillet |
| **Datakilder (widget)** | NYT | 5/12. Garmin-række (forbundet, grøn prik) + Strava-række (connect-flow: orange knap → forbundet). Zone-forklaring i klartekst nederst |
| **Zone-labels** | ÆNDRET | Aldrig "Z2"/"Z4" alene. Altid klartekst: Zone 1–2 = "Rolig snak-fart", Zone 3 = "Moderat tempo", Zone 4–5 = "Hårdt tempo"/"Meget hårdt". Hård = rød, rolig/moderat = kobolt |
| **Loader** | NYT | ÉN genbrugelig logo-loader — INGEN skeletons. Statisk løber-glyf over stiplet vej (`stroke-dasharray: 10 14`) der ruller bagud (0.5s linear loop) + mono-statustekst. Se `assets/loader-runner.svg` |
| **Side-loading** | NYT | Widget-området (under hero) dækkes af ét samlet overlay: rgba(233,234,229,0.4) + backdrop-blur 16px + central loader. Nav + hero er IKKE dækket og forbliver klikbare. Fader ud efter ~2s (0.6s opacity ease), fjernes så fra DOM. Hero-km-tal viser dæmpet pulserende "0,0" og tæller op når loaderen lukker |
| **Activities-side** | NYT | Måneds-totaler (km/ture/timer med samme count-up + pulserende 0-state), filter-chips (Alle/Rolig/Moderat/Hård — aktiv = kobolt pill), aktivitetsrækker som glas-kort med hover |
| **Coach-side** | NYT | Chat-UI: coach-bobler (hvid glas, radius 18/18/18/6) + bruger-bobler (kobolt, 18/18/6/18), typing-indikator (3 pulserende prikker), quick-prompt chips, input-pill + rund send-knap. Højre kolonne: Ugens fokus (kobolt), Form-status, Træningsbelastning (14 søjler) |
| **Plan-side** | NYT | Fase-tidslinje (Base ✓ / Build · nu / Peak / Taper / Race), ugekalender 7 kolonner (i dag = kobolt border, AI-anbefalet pas = kobolt flade m. gnist, hviledag = dashed), kommende uger-liste, rødt Race day-kort (måltid/race-pace/AI-estimat) |
| **Mobil** | NYT | Alt stacket i 1 kolonne. Bund-tab-bar i glas (Hjem/Aktiviteter/Coach/Plan med ikoner, aktiv = fuld opacity). Kompakt topbar med logo + sync. Indhold starter under iOS statusbar. Samme loading-mønster |

---

## 3. Assets (læg i `/public/`)

| Fil | Brug |
|---|---|
| `assets/app-icon.svg` | App-ikon / favicon (1024×1024, kobolt gradient-brik, radius 28 %) |
| `assets/logo-runner-cobalt.svg` | Glyf i kobolt — til lyse flader |
| `assets/logo-runner-silver.svg` | Glyf i sølv — til kobolt-brikken i nav + mørke flader |
| `assets/loader-runner.svg` | Loader med indbygget vej-animation (CSS i SVG) |

Wordmark er ren tekst: `stride` i Bricolage Grotesque 700, lowercase, letter-spacing −0.03em.

---

## 4. Før/efter

**Før** (gammelt design): mørkt tema med volt-grøn accent, Space Grotesk/Geist, flade kort, "Z2"/"Z4" zone-koder, intet logo-koncept. Findes i den eksisterende kodebase.

**Efter** (dette redesign) — screenshots i `screenshots/`:

| Side | Screenshot |
|---|---|
| Hjem (desktop) | `screenshots/desktop-hjem.png` |
| Activities (desktop) | `screenshots/desktop-activities.png` |
| Coach (desktop) | `screenshots/desktop-coach.png` |
| Plan (desktop) | `screenshots/desktop-plan.png` |
| Hjem (mobil, i iPhone-ramme) | `screenshots/mobile-hjem.png` |

Kør evt. HTML-filerne i `design-files/` direkte i en browser for at se animationer, loading-flow og interaktioner live (mobil-filen kræver `ios-frame.jsx` i samme mappe — selve rammen er KUN preview-chrome og skal ikke implementeres).

---

## 5. Interaktioner & animationer

| Animation | Detaljer |
|---|---|
| Count-up (hero-km, totaler) | 1,2s, ease-out cubic (`1-(1-p)^3`), start når loading-overlay lukker. Dansk talformat (komma-decimal) |
| Widget-entrance | fadeUp: translateY(10px)+opacity → 0/1, 0.5–0.7s ease, staggered delays 0.05–0.48s |
| Graf-linjer | stroke-dasharray + dashoffset-animation, 1,4–2s cubic-bezier(.4,0,.2,1) |
| Søjler | scaleY fra bunden (transform-origin:bottom), 0.7–0.8s cubic-bezier(.2,.8,.2,1), staggered |
| Loader-vej | stroke-dashoffset 0→24, 0.5s linear infinite |
| Loading-overlay | vises ved data-fetch → fade 0.6s ease → unmount. Baggrund blurres, nav/hero friholdes |
| Sync-flow | idle → syncing (1,8s simuleret; reelt: indtil API-svar) → synced |
| Baggrunds-blobs | 14–22s ease-in-out infinite drift |
| Hover | Nav-links: muted→cobalt. Rækker: baggrund lysner (0.58 opacity). Knapper: en nuance mørkere/lysere |
| Logo (nav) | Ved page load: de tre streger tegner sig (stroke-dashoffset, 0.6s staggered) — valgfrit nice-to-have |

**Ingen skeleton-loaders nogen steder** — kun logo-loaderen.

## 6. State

- `syncState: 'idle' | 'syncing' | 'synced'` — pr. side (eller global)
- `pageLoading: boolean` — styrer overlay + count-up-trigger
- `stravaConnected: boolean` — styrer Datakilder-widgettens Strava-række
- `activityFilter: 'alle' | 'rolig' | 'moderat' | 'haard'` — Activities-siden
- Chat: `messages[]`, `draft`, `typing` — Coach-siden

## 7. Kort (Rute-widget)

- **Leaflet** + CARTO tiles: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` (gratis, ingen API-nøgle)
- Alle interaktioner slået fra (dragging, zoom, tap) — kortet er en visning, ikke et kort-UI
- `fitBounds` på rutens koordinater med padding 22px
- Rute: 2 polylines (glow: rød 9px/22 % + streg: rød 3,5px), start = kobolt circleMarker, slut = rød
- I produktion: brug aktivitetens rigtige GPS-polyline fra Garmin/Strava API

## 8. Filer i denne pakke

```
design_handoff_cobalt_glass/
├── redesign-spec.md              ← denne fil (læg evt. i /docs/ i repo'et)
├── assets/                       ← SVG'er (læg i /public/)
├── screenshots/                  ← "efter"-billeder pr. side
└── design-files/                 ← HTML-designreferencer (åbn i browser)
    ├── Stride Dashboard (Cobalt Glass).dc.html   ← Hjem
    ├── Stride Activities (Cobalt Glass).dc.html
    ├── Stride Coach (Cobalt Glass).dc.html
    ├── Stride Plan (Cobalt Glass).dc.html
    ├── Stride Mobile (Cobalt Glass).dc.html      ← mobil-layout (i iPhone-ramme)
    └── ios-frame.jsx                              ← kun preview-chrome, skal IKKE implementeres
```
