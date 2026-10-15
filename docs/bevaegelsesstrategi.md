# Beslutningsdokument: bevægelsesstrategi for Stride (issue #305)

**Til:** Benjamin (produktejer)
**Status:** research — beslutning, ingen kode
**Relaterede issues:** #304 (login-indgang), #306 (Flip Text), #307 (Lenis), #308 (navbar-pille). Dette dokument er #305.

---

## Kort konklusion

**Beslutning (opdateret 2026-10-15, #304): Motion hentes ind.** Produktejeren har ombestemt den oprindelige research-anbefaling: kvaliteten af bevægelsen vejer tungere end bundlestørrelsen — "45 kB er helt okay hvis det bliver gjort ordentligt". Beslutningen ændrer ikke de målte priser; den oprindelige konklusion står nedenfor som det historiske grundlag. Hvad der ændrede sig og hvorfor: afsnit f); hvilken falsifikator der udløste det: afsnit h).

**Oprindelig konklusion (research, uændret):** Bliv på CSS-keyframes. Udvid `cg-*`-vokabularet i `app/globals.css`, og løs pille-navbarens scroll-adfærd med en lille scroll-lytter i stedet for et animationsbibliotek. Ingen ny afhængighed.

De målte priser (minificeret bundle, gzip-9, React holdt udenfor — metode i afsnit d) er uændrede fakta, før som efter beslutningen:

| Mulighed | Målt størrelse |
| --- | --- |
| Motion (`motion/react`, `motion` + `AnimatePresence`) | 45,8 kB gzip |
| Motion (`motion` alene) | 44,1 kB gzip |
| Motion (`m`, mini-varianten) | 5,3 kB gzip |
| GSAP + ScrollTrigger | 44,0 kB gzip |
| Lenis | 5,3 kB gzip |
| CSS-keyframes (anbefalingen) | 0 kB JavaScript |

Reference-templaten Project One bruger **både** Motion og GSAP. Dens pille-navbar er implementeret med Motion — men selve effekten (en pille der skalerer ind ved load og skjules ved scroll-ned) kan genskabes med CSS plus en lille scroll-lytter, uden bibliotek. ObsidianUI's `flip-text` (kandidat til #306) bruger slet ingen bevægelsesafhængighed — dens `dependencies` er kun `clsx` og `tailwind-merge` — og dens CSS følger ikke med i leverancen, så keyframes skal skrives lokalt uanset valg. ObsidianUI's `text-stream` kræver `gsap` (44,0 kB gzip), men Stride har ikke brug for den blok.

Rækkefølge for det øvrige arbejde: **#304 → #306 → #308**, og **#307 (Lenis) sidst** som sin helt egen, separate beslutning.

---

## Sådan læser du dette dokument (ærlighedsgrænse)

Dette dokument er skrevet uden skærm. Det meste er læst statisk eller i kildekode; afsnit a.5 er undtagelsen — en runtime-måling i en rigtig browser. Hver påstand er mærket med sin evidensform:

- **[observeret-HTML]** — læst i statiske filer fra siden (HTML, CSS og JS-chunks) hentet med `curl`. Ingen rendering, ingen interaktion.
- **[observeret-kilde]** — læst i kildekoden i det repo, som projekt-one-siden selv linker til (klonet med `git clone --depth 1`). Stadig ikke set i en browser.
- **[observeret-runtime]** — målt i en rigtig browser (headless Chromium via Playwright, samme browser som Strides e2e-suite bruger) mod den deployede side, 2026-10-15. Stærkere evidens end statisk læsning, men dækker kun det målte tidsvindue og de målte egenskaber.
- **[udledt]** — en slutning fra det observerede. Kan være forkert.
- **[ikke undersøgt]** — kræver visuel undersøgelse eller runtime-test. Der er ingen påstand at trække på her.

Alt der handler om *hvordan* noget føles — fart, blødhed, parallakse, blur, om pillen reagerer pænt ved scroll, om en easing virker dyr eller billig — er fortsat **[ikke undersøgt]** i dette dokument. Runtime-målingen i a.5 ændrer ikke dette: den måler tal, ikke oplevelse. Det er et krav fra issue #305, ikke en formulering.

---

## a) Reference-digest: Project One (`www.project-one.obsidianui.dev`)

Siden er SSR'et (`x-nextjs-prerender: 1`, `x-vercel-cache: HIT`), så markuppen kan læses statisk. Hentet 2026-10-15 med:

```bash
curl -sL --compressed -A "Mozilla/5.0" "https://www.project-one.obsidianui.dev/" -o /tmp/opencode/project-one.html   # 65.786 B
curl -sL --compressed "https://www.project-one.obsidianui.dev/_next/static/chunks/2d6e71d23e1504be.css" ...            # 3.357 B
curl -sL --compressed "https://www.project-one.obsidianui.dev/_next/static/chunks/b2ab8eaf2e19a639.css" ...            # 108.285 B
```

### a.1 Observeret (HTML og CSS)

- **[observeret-HTML]** Den ydre beholder og pillen, citeret ordret fra HTML'en (kun linjebrud tilføjet):

  ```html
  <div class="mobile-menu-container fixed top-0 left-0 w-full h-[100px] flex items-center justify-center z-50">
    <div class="border border-zinc-700 bg-black py-2 md:py-3 px-5 md:px-7 rounded-full flex justify-between w-[92%] md:w-auto md:gap-32 shadow-2xl shadow-zinc-800 origin-center" style="opacity:0;transform:scaleX(0) scaleY(0)">
  ```

  Pillen er altså server-renderet i en **starttilstand hvor den er usynlig og skaleret til nul** (`opacity:0;transform:scaleX(0) scaleY(0)`). Noget skal animere den ind — men *hvad* og *hvordan* kan HTML'en alene ikke sige.

- **[observeret-HTML]** Forespørgslen indeholder i alt 17 inline-starttilstande af denne type: 6× `opacity:0;transform:rotate(-90deg)`, 5× `opacity:0;transform:translateY(30px)`, 3× `opacity:0`, 1× `opacity:0;transform:translateY(20px) scale(0.96)`, 1× `opacity:0;transform:scaleX(0) scaleY(0)` (pillen), 1× `opacity:0;transform:scale(0)`. Desuden står to understregninger med `style="width:0px"`, og et par elementer står med `style="opacity:1;transform:none"` — dvs. en blanding af "afventer animation" og "allerede animeret ind".

- **[observeret-HTML]** Bevægelsesbibliotekerne kan delvist genfindes i de udleverede scriptchunks (17 filer, 1,2 MB, hentet og greppet): ét chunk indeholder læsbare GSAP-markører (`gsapVersions`, `registerPlugin`, gentagne `matchMedia(`-kald). Der findes til gengæld **ingen** læsbare `framer-motion`/`motion-dom`-strenge i chunks — minificering fjerner typisk den slags navne — så Motion-brugen på den kørende side er bekræftet via kildekoden (a.2), ikke via bundlen.

- **[observeret-HTML]** De to CSS-chunks indeholder kun disse `@keyframes`: `enter`, `exit`, `fadeIn`, `ping`, `pulse`, `slideUp`, `spin` (Tailwind-/tw-animate-navne). Der er **nul** træf af `prefers-reduced-motion` i de to hentede CSS-filer (søgt med `rg -c 'prefers-reduced-motion'`), men målt i browseren på tværs af **alle** stylesheets findes der **1** regel (a.5) — nul-træffet gælder altså kun de to chunks.

### a.2 Observeret (kildekode i det linkede repo)

Siden linker selv til sit kilderepo (`https://github.com/Atharvsinh-codez/Project-1`, fundet som `href` i HTML'en). Repoet er klonet til `/tmp/opencode/project-1-src`. Det er **kildekode, ikke en observation af den kørende side** — men det svarer på det HTML'en ikke kunne:

- **[observeret-kilde]** Pille-navbaren ligger i `components/landing-page/navbar/navbar.tsx`. Kernen er en `motion.div` (fra `motion/react`) med `initial={{ scaleX: 0, scaleY: 0, opacity: 0 }}`, `animate` der skifter mellem 0 og 1 ud fra en `isVisible`-state, og `transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}`. Starttilstanden i kildekoden matcher præcis den inline-style, HTML'en server-renderer — det er den stærkeste kobling mellem de to observationslag.
- **[observeret-kilde]** Show/hide-styringen ved scroll er **ikke** scroll-position i Motions forstand: det er en almindelig `window.addEventListener("scroll", …, { passive: true })`-lytter, der akkumulerer scroll-delta (`scrollThreshold = 120`, skjul når `current > 150` og akkumuleret delta > 120, vis igen ved scroll-op). Altså: Motion bruges til *animationen*, ikke til at *aflæse* scroll.
- **[observeret-kilde]** Motion bruges i 12 filer i repoet (navbar, hero, FAQ, how-it-works, logo, kontakt- og about-sider m.fl.). GSAP bruges i **én** fil: `components/landing-page/hero/hero-text.tsx` (`gsap.to` + `ScrollTrigger` + `useGSAP`).
- **[observeret-kilde]** `package.json` i repoet erklærer både `motion ^12.23.24`, `gsap ^3.13.0`, `@gsap/react ^2.1.2` og `tw-animate-css ^1.4.0`.
- **[observeret-kilde]** Der findes **ingen** `prefers-reduced-motion`-håndtering og ingen `useReducedMotion` nogen steder i repoet (søgt i hele træet ekskl. `node_modules` — nul træf).

### a.3 Udledt

- **[udledt]** Den deployede side kører sandsynligvis tæt på repoets `main`, fordi starttilstandene i den server-renderede HTML matcher `navbar.tsx`'s `initial`-props eksakt (inkl. `scaleX(0) scaleY(0)`). Den præcise revision er ikke verificeret.
- **[udledt]** Pille-entréen på den kørende side har omkring 0,8 s varighed og en eksponentielt aftagende kurve (`cubic-bezier(0.23, 1, 0.32, 1)`), og pillen skjuler sig efter ca. 120 px akkumuleret scroll-ned. Det er *udledt af kilden*, ikke observeret — men runtime-målingen (a.5) [observeret-runtime] er konsistent med billedet: 0,496 ved 300 ms, 0,987 ved 600 ms og fuld ved 1000 ms, og skjul målt ved 900 px scroll-ned. Hvordan det føles, er fortsat ikke undersøgt.

### a.4 Ikke undersøgt — hvad der fortsat mangler

Runtime-målingen i a.5 har flyttet pillens entré, dens skjul/vis ved scroll, baggrundsdriften og mobil-layoutet fra "ikke undersøgt" til målt. Tilbage står:

- **[ikke undersøgt]** Hvordan bevægelsen *opleves*: jank, blødhed, om entréen og pillen er distraherende. Tallene i a.5 er tal, ikke en bedømmelse. Det gælder også den præcise stagger-rækkefølge og om noget flasher eller hopper ved load.
- **[ikke undersøgt]** Om der ud over pillens show/hide findes scroll-koblet bevægelse (parallakse) på siden. Målingen dækkede pillen og de fire tidsdrevne baggrundelementer — ikke om baggrundselementerne selv reagerer på scroll.
- **[ikke undersøgt]** Om pillen opleves som hjælpsom eller distraherende på Strides sider, og hvordan den bør opføre sig på mobil hvor Stride allerede har `BottomTabBar`.
- **[ikke undersøgt]** Ydeevne på rigtige telefoner (jank, paint, batteri) — hverken for Motion eller CSS.
- **[ikke undersøgt]** Om den deployede revision, som a.5 er målt mod, matcher repoets `main` (jf. a.3).

### a.5 Observeret i browser (runtime-måling)

**Alt i dette afsnit er [observeret-runtime].** Målt 2026-10-15 mod den kørende deployede side med headless Chromium via Playwright (samme browser som Strides e2e-suite bruger, hentet fra repoets `node_modules`). Metode: tre scratch-probes kørt fra `/tmp/po`, viewport 1440×900, `waitUntil: "load"`, sampling ved t = 120/300/600/1000/1600/2600 ms af computed style (opacity, scale, størrelse, position) og antal aktive animationer; derefter 900 px scroll ned og 400 px op. En tredje probe samplede de fire baggrundselementer tre gange over 2,2 s (første sample umiddelbart efter `load`, derefter efter +0,9 s og +2,2 s) for at afgøre, om filter og transform er konstante — det er de ikke, og derfor viser tabellen intervaller. Repoet blev ikke ændret under målingen. Sidefejl i konsollen: 0.

#### Nav-pillens entré (opacity + scale, begge samtidigt)

| t (ms) | opacity | scale | bredde (px) | højde (px) | top (px) | kørende animationer |
| --- | --- | --- | --- | --- | --- | --- |
| 120 | 0 | 0,0 | 0 | 0 | 50 | 27 |
| 300 | 0,496 | 0,497 | 354,2 | 34,8 | 32,6 | 27 |
| 600 | 0,987 | 0,989 | 704,3 | 69,2 | 15,4 | 16 |
| 1000 | 1 | none | 712,3 | 70 | 15 | 9 |
| 1600 | 1 | none | 712,3 | 70 | 15 | 7 |
| 2600 | 1 | none | 712,3 | 70 | 15 | 6 |

- Pillen vokser fra **nul** (scale 0 + opacity 0) til **712×70 px** på omkring 600–1000 ms og ender centreret med `top: 15 px`. Det er ikke en fade — størrelsen animeres.
- `border-radius` er `rounded-full` (målt som 3,36e+07 px = clampet). Baggrunden er **opak sort** (`rgb(0, 0, 0)`), og `backdrop-filter` er **`none`** — pillen er altså **ikke** glas/blur, den er massiv sort. Det er en relevant detalje her, fordi Strides egen nav er glas-pille (`cg-glass`).
- Elementer med inline `opacity: 0` falder fra 18 (t=120 ms) til 0 (t=2600 ms) — indholdet kommer ind trinvist.

#### Skjul/vis ved scroll

| Handling | opacity | scale | top (px) | scrollY |
| --- | --- | --- | --- | --- |
| efter 900 px ned | 0,0014 | 0,0011 | 50,0 | 900 |
| efter 400 px op | 0,9957 | 0,9957 | 15,1 | 500 |

Skjul er altså **samme bevægelse som entréen, kørt baglæns** (scale+opacity mod nul, og pillen flytter tilbage til `top: 50`), ikke en translate-væk. At en scroll-lytter toggler en boolean, og at animationen kører i JS, er ikke målt her, men konsistent med kildekode-læsningen i a.2. [udledt]

#### De svævende baggrundselementer (4 stk.)

Alle fire er `<img>`, absolut positioneret, med Tailwind-klasser og præcis **én** kørende animation hver, som stadig kører efter 2,6 s (dvs. uendelig drift):

| # | klasser (forkortet) | målt størrelse | position | varighed | easing | rotation (z, grader) | translate (x, y) px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `absolute h-[60px] md:h-[120px] top-[15%] left-[5%] md:top-[18%] md:left-[12%]` | 144×150 px | top 126, left 167 | 4000 ms | ease-in-out | 13,54 → 20,22 → 20,59 | (0,9, −2,6) → (7,6, −21,3) → (8,0, −22,3) |
| 2 | `absolute h-[50px] md:h-[100px] top-[10%] right-[5%] md:top-[8%] md:right-[14%]` | 126×132 px | top 25, left 1115 | 5000 ms | ease-in-out | 17,20 → 22,11 → 26,57 | (−0,7, −1,9) → (−6,6, −17,6) → (−11,9, −31,9) |
| 3 | `absolute h-[65px] md:h-[130px] top-[55%] left-[2%] md:top-[62%] md:left-[6%]` | 170×176 px | top 500, left 80 | 4500 ms | ease-in-out | 21,34 → 27,10 → 30,06 | (1,0, −2,8) → (9,1, −24,6) → (13,2, −35,9) |
| 4 | `absolute h-[70px] md:h-[135px] top-[60%] right-[2%] md:top-[70%] md:right-[3%]` | 177×185 px | top 564, left 1225 | 6000 ms | ease-in-out | 23,02 → 26,60 → 32,30 | (−0,6, −1,7) → (−6,4, −16,8) → (−15,5, −40,7) |

Værdierne er tre samples pr. element (første sample umiddelbart efter `load`, derefter +0,9 s og +2,2 s). Alle fire har **scale 0,98583** i alle tre samples og en fast 3D-tilt (matrix3d-z-komponenter 0,167731 og 0,258819 — sidstnævnte er sin 15°). Rotationen er z-rotation i grader, translate er i px (x, y). Bemærk retningen: element 1 og 3 bevæger sig mod **højre** (positiv x), element 2 og 4 mod **venstre** — det er spejlet.

Filtrene består af **to drop-shadow-lag pr. element**, og både alpha og blur **ændrer sig over tid** — de følger elementets bevægelse. Et enkelt tal kan derfor ikke læses som en fast værdi; tabellen nedenfor viser første og sidste sample.

**De to skyggelag pr. element** ([observeret-runtime], målt ved første og sidste sample):

| # | lag 1 (først) | lag 1 (sidst) | lag 2 (først) | lag 2 (sidst) |
| --- | --- | --- | --- | --- |
| 1 | `rgba(0,0,0,0.455) 0px 20,64px 35,86px` | `rgba(0,0,0,0.498) 0px 27,48px 44,98px` | `rgba(0,0,0,0.306) 0px 8,30px 15,64px` | `rgba(0,0,0,0.35) 0px 11,49px 22,48px` |
| 2 | `rgba(0,0,0,0.455) 0px 18,33px 30,68px` | `rgba(0,0,0,0.54) 0px 29,03px 52,99px` | `rgba(0,0,0,0.325) 0px 10,14px 20,27px` | `rgba(0,0,0,0.41) 0px 14,60px 29,20px` |
| 3 | `rgba(0,0,0,0.506) 0px 22,44px 40,84px` | `rgba(0,0,0,0.557) 0px 31,41px 58,09px` | `rgba(0,0,0,0.353) 0px 12,20px 25,34px` | `rgba(0,0,0,0.424) 0px 16,34px 32,24px` |
| 4 | `rgba(0,0,0,0.52) 0px 24,30px 45,47px` | `rgba(0,0,0,0.584) 0px 36,51px 64,55px` | `rgba(0,0,0,0.38) 0px 15,13px 30,19px` | `rgba(0,0,0,0.46) 0px 20,47px 37,82px` |

Mønstret er altså: **fire store, bløde skygger** (`drop-shadow`, ikke blur), og bevægelsen er en **svajen** — rotation + translate samtidigt, ikke translate alene. Svajen er den primære bevægelse, ikke en bibemærkning. Fire forskellige varigheder (4,0/4,5/5,0/6,0 s) med samme easing — det er den "levende baggrund". Ingen af dem er CSS-keyframes; de kører alle som JS-animationer, og derfor er der 6 JS-animationer i alt i ro (4 baggrund + pillen + én mere).

#### Mobil (390×844)

- Nav-pillen måler **358,8 × 62 px**, placeret `top: 19`, `left: 15,6` — dvs. ~92 % bredde med ca. 16 px luft i siderne, stadig en pille.
- `document.scrollWidth` = 390 = viewport → **ingen horisontal overflow**.

#### Korrektion af en tidligere påstand

Afsnit a.1's nul-træf for `prefers-reduced-motion` gælder kun de to hentede CSS-chunks. Målt i browseren findes der **1** regel med `prefers-reduced-motion` på tværs af alle stylesheets. Konklusionen kan altså stå, nu afgrænset og målt: projekt-one håndterer ikke reduceret bevægelse systematisk, men siden er ikke helt uden en regel. [observeret-runtime]

---

## b) Reference-digest: ObsidianUI (de to blokke der er kandidater)

Hentet 2026-10-15: `https://obsidianui.dev/llms.txt`, samt registry-payloadene `https://www.obsidianui.dev/r/flip-text.json` og `https://www.obsidianui.dev/r/text-stream.json`.

- **[observeret-HTML]** `flip-text`-payloaden erklærer `dependencies: ["clsx", "tailwind-merge"]` — **ingen Motion, ingen GSAP**. Filen leverer kun `flip-text.tsx` + `lib/utils.ts`. Kilden er CSS-drevet: hvert tegn får custom properties (`--flip-duration`, `--flip-delay`, `--flip-iteration`) og klassen `.flip-char`, men payloaden indeholder **hverken `@keyframes` eller `prefers-reduced-motion`** (0 forekomster af begge i kilden). Den CSS der faktisk animerer tegnene følger altså ikke med — den skal skrives lokalt uanset hvad.
- **[observeret-HTML]** `text-stream`-payloaden erklærer `dependencies: ["clsx", "gsap", "tailwind-merge"]`. Blokken bruger `gsap` + `gsap.matchMedia()` (kun aktiv uden for `prefers-reduced-motion: reduce`) og har desuden en CSS-media-query der nulstiller transform og mask ved reduced motion. Det er et observeret eksempel på, hvordan GSAP + reduced-motion kan håndteres.
- **[ikke undersøgt]** Den generelle påstand "ObsidianUI bygger på Motion" er **ikke** verificeret bredt her — kun disse to blokke er efterprøvet. Hvis flere blokke skal bruges senere, skal deres payloads læses på samme måde.

---

## c) Hvad Stride har i dag (verificeret i repoet)

- `app/globals.css:254-352` definerer `cg-drift1`, `cg-drift2`, `cg-drift3`, `cg-fade-up`, `cg-pulse-dot`, `cg-ping-dot`, `cg-draw-line`, `cg-grow-bar`, `cg-grow-bar-x`, `cg-ground-move`, `cg-overlay-fade`. `cg-fade-up` er brugt 25 steder i `app/` og `components/`; `cg-pulse-dot` i 6 filer; `cg-draw-line`, `cg-grow-bar` og `cg-grow-bar-x` er i dag defineret men ikke refereret fra nogen komponent.
- Reduceret bevægelse er allerede husstandarden: media query ved `app/globals.css:138` (loader) og `:246` (`cg-interactive`), og `motion-reduce:animate-none`-varianter i `BackgroundBlobs.tsx:51`, `RunnerLoader.tsx:59` og `LoadingOverlay.tsx:44`.
- Baggrundsdriften findes: `BackgroundBlobs.tsx` tegner tre drivende blobs, som login-layoutet allerede bruger (`app/(auth)/layout.tsx`).
- Entré-mønsteret findes: `PreviewShowcase.tsx:36-41` flipper et `started`-flag 250 ms efter mount og lader rigtige widgets animere ind; `CountUpNumber`, `VolumeCard` og `PaceTrendCard` tager imod flaget.
- Login-siden (`app/(auth)/login/page.tsx`) er i dag næsten helt statisk: kun `Loader2`-spin på knappen mens OAuth kører, plus `cg-interactive`-trykfeedback.
- Navigationen (`components/cobalt/NavBar.tsx`, `BottomTabBar.tsx`) er allerede glas-piller (issue #100) — men statiske: ingen entré, ingen scroll-adfærd.
- `tw-animate-css` er allerede en afhængighed og importeres i `app/globals.css:2` (leverer `enter`/`exit`-utility-klasser til CSS).
- CSP (`lib/csp.ts`): scripts kører med per-request nonce + `'strict-dynamic'`; `style-src` har bevidst `'unsafe-inline'` fordi Tailwind, Recharts og MapLibre skriver inline-styles (kommentaren i `lib/csp.ts:25-27`). `'unsafe-eval'` er kun i dev.

---

## d) Målinger: metode og tal

Alt er målt 2026-10-15. Repoet er ikke rørt; pakkerne blev hentet som tarballs til `/tmp` og pakket ud i en scratch-mappe. Eksakte kommandoer:

```bash
npm pack motion framer-motion --pack-destination /tmp/opencode/packs        # motion 14.3.0, framer-motion 14.3.0
npm pack motion-dom@14.3.0 motion-utils@14.1.1 --pack-destination /tmp/opencode/packs
npm pack gsap lenis tslib --pack-destination /tmp/opencode/packs            # gsap 3.15.0, lenis 1.3.27, tslib 2.8.1

mkdir -p /tmp/opencode/measure/node_modules/<navn>
tar -xzf <pakke>.tgz -C /tmp/opencode/measure/node_modules/<navn> --strip-components=1

npx --yes esbuild entry.js --bundle --minify --format=esm \
  --external:react --external:react/jsx-runtime --outfile=out.js           # esbuild 0.28.2
python3 -c "import gzip; print(len(gzip.compress(open('out.js','rb').read(), 9, mtime=0)))"
```

Entry-filerne der blev bundlet: `import { m } from "motion/react"`, `import { motion } from "motion/react"`, `import { motion, AnimatePresence } from "motion/react"`, `import { gsap } from "gsap"` + `import { ScrollTrigger } from "gsap/ScrollTrigger"` + `gsap.registerPlugin(ScrollTrigger)`, og `import Lenis from "lenis"`. React er `--external` fordi Stride allerede har React — tallene er det **inkrementelle** bidrag ud over React.

| Import | Rå (minificeret) | gzip-9 |
| --- | --- | --- |
| `motion/react` → `m` | 13,0 kB | 5,3 kB |
| `motion/react` → `motion` | 131,4 kB | 44,1 kB |
| `motion/react` → `motion` + `AnimatePresence` | 135,6 kB | 45,8 kB |
| `gsap` + `gsap/ScrollTrigger` | 112,5 kB | 44,0 kB |
| `lenis` | 18,3 kB | 5,3 kB |

To ting, der er værd at vide om metoden:

- **Den deklarerede entry-fil alene er misvisende.** `motion/dist/es/react.mjs` er 721 B rå (409 B gzip) — fordi den blot re-eksporterer `framer-motion`. Samme mønster: `gsap/index.js` er 664 B og re-eksporterer `gsap-core.js` + `CSSPlugin.js`. En "entry-point-måling" uden bundling ville undervurdere prisen med to størrelsesordener; derfor er tallene ovenfor bundlet.
- **Øvre grænse, hvis intet tree-shakes.** Summen af hele `dist/es`-træerne (konkatenation, gzip-9): `framer-motion` 69,8 kB, `motion-dom` 125,3 kB, `motion-utils` 4,2 kB, `motion` selv 4,2 kB. Det er "alt importeres"-tal, ikke den realistiske pris — den realistiske pris er rækkerne i tabellen.

**Ikke målt:**

- [ikke undersøgt] Den faktiske Turbopack-chunk-effekt i Stride. esbuild ≠ Next's bundler; retningen er sammenlignelig, men et præcist Next-tal kan kun fås ved at tilføje afhængigheden — og det er udelukket i #305.
- [ikke undersøgt] Runtime-effekt: CPU, INP, paint og batteri på rigtige telefoner.
- [ikke undersøgt] CSS-vejens præcise byte-delta. Udgangspunktet er `app/globals.css` på 10.155 B i dag; nye keyframes er i størrelsesordenen få hundrede bytes CSS hver, og **0 B JavaScript**. Det præcise minificerede delta er ikke opgjort.
- [ikke undersøgt] GSAP uden ScrollTrigger som separat bundle (kun målt med ScrollTrigger, som er det realistiske scenarie for scroll-effekter).

---

## e) De tre muligheder

### Mulighed 1 — Blive på CSS-keyframes (udvid `cg-*`)

**Bundle-omkostning: 0 kB JavaScript** (målt ved konstruktion — der tilføjes ingen afhængighed). CSS-deltaet er ikke opgjort præcist, men er få hundrede bytes ukomprimeret CSS pr. keyframe.

**Kan vokabularet bære de tre ønsker?**

- *Baggrundsdrift*: bæres allerede i dag (`cg-drift1-3` + `BackgroundBlobs`).
- *Entré*: `cg-fade-up` findes og bruges 25 steder. Stagger fås med `animation-delay` pr. element; den eksisterende `started`-flag-model (`PreviewShowcase`) dækker de tilfælde hvor koreografien skal vente et beat efter mount.
- *Pille-navbar*: udseendet og entréen kan bygges i CSS (skalér/opacity-transition på klasse-skift, genbrug af `cg-glass`). Runtime-målingen (a.5, [observeret-runtime]) **bekræfter** det: referencens entré er scale+opacity samtidigt fra nul til fuld størrelse, og skjul er samme bevægelse baglæns — der er intet i selve effekten, CSS ikke kan udtrykke. **Den ærlige begrænsning:** show/hide ved scroll *retning* kræver JS-state. Men det behov er præcis hvad Project One løser — konsistent med a.2: en passiv scroll-lytter og en boolean. I Stride ville det være en lille client-hook (`useScrollDirection`) der toggler en klasse; motionen forbliver CSS. (Referencens pille er i øvrigt målt som opak sort, ikke glas — Stride beholder derfor sit eget `cg-glass`-udseende og kopierer kun adfærden.)

**CSP (`lib/csp.ts`):** ingen ændring nødvendig. Ingen nye origins, ingen inline-scripts, intet `eval`.

**`prefers-reduced-motion`:** følger husstandarden. Entré-keyframes skal designes, så elementet er **synligt som default** og kun animeres af `animation` — så `motion-reduce:animate-none` efterlader indholdet synligt i stedet for skjult. Det er allerede mønsteret i `BackgroundBlobs`, `RunnerLoader` og `LoadingOverlay`.

**SSR/hydration-risiko:** tæt på nul. Klasserne er i den server-renderede HTML, animationen starter fra stylesheetet, og der er ingen ny hydration-choreografi. Den eneste risiko at passe på: at gøre indhold *afhængigt* af en JS-flagtændt animation (som `PreviewShowcase` gør for selve animationen — indholdet ligger dog stadig i DOM'en).

### Mulighed 2 — `motion` (`motion/react`)

**Bundle-omkostning (målt):** 45,8 kB gzip for `motion` + `AnimatePresence`; 44,1 kB for `motion` alene; 5,3 kB for `m`-varianten. Prisen er betydeligt højere end Motion-brugerens typiske indtryk, fordi hele `framer-motion` + `motion-dom`-motoren følger med.

**CSP:** ingen ændring nødvendig. Biblioteket bundles som appens eget script (nonce + `'strict-dynamic'`) og sætter inline-styles (allerede tilladt i `style-src`). Intet `eval` i prod. [ikke undersøgt] — ikke testet i browser her, kun vurderet ud fra arkitekturen.

**`prefers-reduced-motion`:** Motion har indbygget støtte (`MotionConfig`/`useReducedMotion`), men den skal slås til og vedligeholdes pr. flade; detaljerne i den målte version er ikke verificeret her. Det er en funktionelt god vej, men ikke gratis i opmærksomhed.

**SSR/hydration-risiko:** Motion server-renderer sine starttilstande. Project One er beviset: HTML'en indeholder 17 inline `opacity:0`-stile, dvs. **indhold er usynligt indtil hydration**. Det er håndterbart — men det betyder, at en JS-fejl eller langsom load viser en tom side. Strides sider har i dag ingen sådan afhængighed. (Opdateret 2026-10-15, #304: Stride har nu én — login-kortet entrer med Motion og server-rendres i `hidden`-tilstanden (`opacity:0`), så uden JS ville kortet aldrig blive synligt. Scripts slået fra er dækket med `@media (scripting: none)` i `app/globals.css` og et `<noscript>`-fallback i `app/(auth)/layout.tsx`; en hydration-fejl med JS aktiveret er ikke dækket og står som accepteret residual risiko.) Motion 14's egen kildekode indeholder desuden en kommentar om, at et tidligere re-eksport-mønster fik **Next.js Turbopack til at løbe tør for hukommelse** under module-graf-analyse (rettet i den målte version; historisk note, men viser at integrationsfladen mod Next/Turbopack er reel).

### Mulighed 3 — GSAP

**Bundle-omkostning (målt):** 44,0 kB gzip for `gsap` + `ScrollTrigger` (det realistiske scenarie). Tarballen er 1,6 MB; selve kernens kildefil er 167,7 kB. Adgang til ScrollTrigger kræver `registerPlugin`, og React-integrationen bør bruge `@gsap/react`'s `useGSAP` for korrekt cleanup (som Project One gør).

**CSP:** ingen ændring nødvendig. Samme begrundelse som Motion: bundled script + inline-styles. [ikke undersøgt] i browser her.

**`prefers-reduced-motion`:** manuel pr. animation. ObsidianUI's `text-stream` viser den gode udgave: `gsap.matchMedia()` med `(prefers-reduced-motion: no-preference)` plus en CSS-fallback der nulstiller transform. Virker — men hver enkelt animation skal selv huske det.

**SSR/hydration-risiko:** indhold er synligt som default (GSAP sætter sine "from"-tilstande ved runtime), så en JS-fejl efterlader ikke en tom side. Til gengæld kræver alt refs og client components, og "from"-tilstande sat efter første paint kan give et lille hop (flash) hvis ikke startstilen også findes i CSS. React 19's strenge effekt-dobbelteksekvering kræver `useGSAP`s cleanup.

### Til sammenligning: Lenis (hører til #307, ikke til den generelle beslutning)

**Bundle-omkostning (målt):** 5,3 kB gzip for selve `lenis`; `lenis/react`-entryen er 1,6 kB gzip alene (deklareret entry-fil, ikke bundle). Lenis er den **eneste** af effekterne der ikke kan laves i CSS: blød scroll-smoothing kræver at et JS-lag overtager scroll. Den bør derfor ikke blandes ind i denne beslutning, men afgøres særskilt i #307, hvor dens samspil med MapLibre, dialoger og overlays (issue-tekstens egne undtagelser) kan efterprøves.

---

## f) Anbefaling

**Oprindelig anbefaling (research, 2026-10-15): Vælg Mulighed 1 — bliv på CSS-keyframes.** Udvid `cg-*`-vokabularet med det der mangler (en entré med valgfri stagger samt en flip-keyframe til #306), og byg pille-navbarens scroll-adfærd som en lille client-hook uden animationsbibliotek.

Begrundelser, i prioriteret rækkefølge:

1. **Prisen er målt, og den er skæv.** Motion koster 44,1–45,8 kB gzip for den fulde API; GSAP+ScrollTrigger 44,0 kB. Det er 8–9 gange dyrere end Lenis for funktioner, hvoraf ingen er observeret som nødvendige for Stride endnu. CSS-vejen koster 0 kB JavaScript.
2. **Referencens egen pille er Motion — men effekten er ikke.** Project One bruger Motion til at animere pillen og en almindelig scroll-lytter til at *beslutte* hvornår. Vi kan tage beslutningsdelen (uden bibliotek) og animere i CSS. Det er præcis hvad `PreviewShowcase`-mønsteret allerede gør i Stride.
3. **#306 bliver reelt billigere på CSS-vejen.** ObsidianUI's `flip-text` leverer ingen CSS i det hele taget; keyframes skal skrives lokalt under alle omstændigheder. Motion ville kun betyde, at vi *omskrev* en CSS-drevet blok til en 44 kB-afhængighed — for et system vi allerede har mønster og guard for.
4. **Husstandarden findes allerede:** `cg-*`-vokabular, `motion-reduce`-guards og entré-flaget er indarbejdede mønstre. CSS-vejen forstærker dem; de to andre indfører et parallelt system ved siden af.
5. **Hydration-risikoen holdes på nul.** CSS-entré kræver ingen skjult-indtil-JS-tilstand; alle sider forbliver funktionelle uden JavaScript.
6. **Filosofisk pasform.** Stride er deterministisk og selvstændigt; ingen tredjeparts-runtime i browseren er i tråd med resten af arkitekturen.

**Hvornår ville Motion være det rigtige valg:** hvis vi får behov for entré/exit hen over *unmount* (`AnimatePresence`), delt-layout-morfe (FLIP), fjederfysik eller gestus-drevet koreografi som CSS + små hooks ikke kan udtrykke. Marginalprisen er målt (5,3 kB gzip for `m`, 44,1–45,8 kB for fuld API), så den beslutning er allerede prissat. **Hvornår ville GSAP være det rigtige valg:** kun hvis vi vælger `text-stream`-blokken; ingen andre observerede behov kræver den.

### Opdatering 2026-10-15: beslutningen er ændret — Motion hentes ind (#304)

Produktejeren har ombestemt anbefalingen ovenfor. Beslutningen er nu: **Motion hentes ind.** Kvaliteten af bevægelsen vejer tungere end bundlestørrelsen — "45 kB er helt okay hvis det bliver gjort ordentligt". Hvad der ændrede sig, og hvad der ikke gjorde:

- **Målingen er uændret.** Prisen står ved magt som fakta, præcis som målt i afsnit d: 44,1–45,8 kB gzip for den fulde API, 5,3 kB for `m`-varianten. Det er beslutningen om at betale den pris, der er ny — ikke tallet.
- **Det var kvalitetsvurderingen, der tippede beslutningen.** Prisargumentet i den oprindelige anbefaling (punkt 1) er stadig korrekt som regnestykke; ejeren har vurderet, at reference-kvaliteten i bevægelsen kræver biblioteket, og har accepteret prisen. Dermed er falsifikator 1 i afsnit h udløst: den visuelle efterprøvelse, som a.5 ikke kunne levere, faldt ud til Motions fordel.
- **Husstandarden bevares, ikke erstattes.** Motion bruges med `useReducedMotion()`, så reduced-motion-værnet fra CSS-vejen gælder uændret — et acceptkrav i #304, ikke en option.

I praksis: `motion` (v14.3.0) er installeret og bruges via `motion/react` — ikke `framer-motion`. #304 (login) er den første flade, der tager biblioteket i brug. Om #306 og #308 også bruger Motion eller fortsat CSS afgøres i de issues; beslutningen her handler om, at biblioteket nu er godkendt og tilgængeligt, ikke om at alle flader skal bruge det.

---

## g) Rækkefølge for de øvrige issues

1. **#304 — Login-siden: baggrundsmotion, CTA-hierarki, tydelig demo.** Først, fordi det er den mindste flade, den i dag er den mest statiske, og den fastlægger de to nye CSS-mønstre (entré + stagger) som de næste issues genbruger. Baggrundsdriften er allerede på plads via `(auth)`-layoutet.
2. **#306 — Flip Text som overskrift på login-siden.** Dernæst, fordi den bygger oven på #304's flade, og fordi dens keyframes skal skrives lokalt under alle omstændigheder (observeret: payloaden leverer ingen CSS). Løs den i `cg`-vokabularet med `motion-reduce`-guard.
3. **#308 — Navigation som flydende pille (project-one-mønstret).** Derefter, som ren CSS-pille + lille scroll-retnings-hook. Den nuværende `NavBar` er allerede en glas-pille; tilføjelsen er den flydende opførsel og entréen. Skal sammentænkes med `BottomTabBar` på mobil.
4. **#307 — Lenis på landing + login.** Sidst, som separat beslutning: det er den eneste effekt, CSS ikke kan levere, den har sin egen målte pris (5,3 kB gzip), og den har de største samspils-risici (global scroll-optagelse vs. MapLibre, overlays, kort). Intet i #304/#306/#308 afhænger af den — den kan droppes uden at røre dem.

Rækkefølgen er bevidst: de tre første kompilerer beslutningen ind i CSS-vokabularet og giver hver for sig synlig effekt. #307 er den eneste, der kan falsificere "ingen JS-bevægelsesafhængighed"-linjen — og den afgøres derfor for sig selv. (Opdateret 2026-10-15, #304: linjen er nu falsk — Motion er hentet ind til login-kortets entré, så #307 er ikke længere den eneste vej til en JS-bevægelsesafhængighed; se afsnit f.)

---

## h) Falsifikator: hvad ville ændre anbefalingen

Runtime-efterprøvelsen i a.5 ændrer **ikke** konklusionen i afsnit f: målingerne bekræfter den — referencens pille-entré og pille-skjul er scale+opacity fra nul til fuld størrelse og baglæns. Også baggrundselementerne trækker i samme retning: deres målte bevægelse er en svajen med rotation + translate, og begge dele kan CSS-keyframes udtrykke direkte (`rotate` + `translate` i keyframes). [udledt] At beslutningsdelen er en passiv scroll-lytter uden bibliotek, der toggler en boolean, er konsistent med kildekode-læsningen i a.2, ikke målt i a.5. Falsifikator 1 indsnævres derfor til oplevelsen, som målingen ikke kan bedømme.

**Opdatering 2026-10-15 (#304): falsifikator 1 er udløst, og beslutningen er ændret.** Målingerne nedenfor står uændret — de ændrede ikke konklusionen. Det gjorde oplevelses-vurderingen derimod: ejeren har accepteret Motion-prisen for at få referencekvaliteten (se afsnit f, "Opdatering"), og `motion` bruges derfor fra #304 og frem. Resten af dette afsnit står som den oprindelige falsifikator-analyse.

Anbefalingen er forkert, hvis:

1. **Den visuelle efterprøvelse siger, at CSS-entré/Flip/pille ikke rammer referencekvaliteten.** (Udløst 2026-10-15 — beslutningen er ændret til Motion, se afsnit f.) Runtime-målingen (a.5) [observeret-runtime] har taget den del, der kan måles: referencens pille-entré er samtidig scale+opacity fra 0 til fuld størrelse, og skjul er samme bevægelse baglæns — dvs. CSS-udtrykkeligt. Tilbage er *oplevelsen* (jank, blødhed, om det distraherer). Falder den igennem, er `m`-varianten (5,3 kB gzip) eller fuld Motion (44,1–45,8 kB) standardvalget.
2. **#308 viser sig at kræve delt-layout-morfe eller gestus-drevne overgange** som CSS + scroll-lytter ikke kan udtrykke. Så er Motion begrundet — og prisen er allerede målt.
3. **Route-skift-entré/exit bliver et produktkrav.** CSS kan ikke animere unmount; det kræver `AnimatePresence`.
4. **#307 (Lenis) bliver godkendt.** Så findes der alligevel et JS-bevægelseslag; genåbn samtidig vurderingen af, om Motion skal med i samme ombæring. (Lenis er dog scroll-smoothing, ikke et generelt animationsbibliotek — det alene gør ikke Motion gratis.)
5. **Målte priser ændrer sig materielt** i senere versioner. Metoden i afsnit d er repeterbar; et nyt `motion`-major med markant lavere basispris ville svække prisargumentet.
6. **En reproducerbar CSS-jank opstår på målenheder** (typisk: mange samtidige `animation`s på store blur-lag), hvor Motion er dokumenterbart glattere. Interessant nok er det modsatte lige så ofte sandt — men målingen mangler, og ingen af påstandene må tages for givet uden den.

---

## Kilder og uafklaret

**Primære kilder (hentet 2026-10-15):**

- Project One (deployet): `https://www.project-one.obsidianui.dev/` — HTML 65.786 B, CSS-chunks 3.357 B + 108.285 B, JS-chunks 17 filer/1,2 MB (greppet for biblioteksmarkører); hentet med `curl -sL --compressed`.
- Project One (kilderepo, linket fra siden selv): `https://github.com/Atharvsinh-codez/Project-1` — `git clone --depth 1`; læst: `components/landing-page/navbar/navbar.tsx`, `components/landing-page/hero/hero-text.tsx`, `package.json`.
- ObsidianUI: `https://obsidianui.dev/llms.txt`; registry-payloads `https://www.obsidianui.dev/r/flip-text.json` og `https://www.obsidianui.dev/r/text-stream.json`; dokumentation `https://www.obsidianui.dev/markdown/docs/flip-text.md`.
- npm-tarballs (målt): `motion@14.3.0`, `framer-motion@14.3.0`, `motion-dom@14.3.0`, `motion-utils@14.1.1`, `tslib@2.8.1`, `gsap@3.15.0`, `lenis@1.3.27`, hentet med `npm pack` til `/tmp/opencode/packs`; bundlet med esbuild 0.28.2 (via `npx`, uden for repoet) og gzippet med Python `gzip -9`.
- Runtime-måling (a.5): to scratch-probes i `/tmp/po` med Playwright + Chromium fra repoets `node_modules` mod den deployede side, 2026-10-15; repoet blev ikke ændret.

**Verificeret i Stride-repoet (denne branch):** `app/globals.css`, `components/cobalt/BackgroundBlobs.tsx`, `components/cobalt/velkommen/PreviewShowcase.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/layout.tsx`, `components/cobalt/NavBar.tsx`, `package.json`, `lib/csp.ts`.

**Uafklaret / ikke undersøgt:** hvordan Project Ones bevægelse *opleves* — jank, blødhed, om den distraherer (timing og størrelser er nu målt i a.5, bedømmelsen mangler); om den deployede revision (som a.5 er målt mod) er identisk med repoets `main`; om der ud over pillens show/hide findes scroll-koblet bevægelse; ObsidianUI's generelle Motion-brug ud over de to læste blokke; Lenis' reduced-motion-håndtering i kilden; Turbopack-chunk-effekten i Stride; runtime-ydeevne på rigtige telefoner.
