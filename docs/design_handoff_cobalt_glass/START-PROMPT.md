# Start-prompt til Claude Code (Opus) — Stride Cobalt Glass redesign

> Kopiér alt herunder ind som første besked til din agent, efter at mappen
> `design_handoff_cobalt_glass/` er lagt i repo'et (fx i roden eller `/docs/`).

---

Du skal implementere et komplet redesign af Stride (Next.js running-dashboard) kaldet **Cobalt Glass**.

## Kilder — læs i denne rækkefølge

1. `design_handoff_cobalt_glass/redesign-spec.md` — HELE spec'en: design tokens (CSS-vars + Tailwind), komponent-tabel, animationer, state, kort-opsætning. Læs den grundigt før du skriver kode.
2. `design_handoff_cobalt_glass/screenshots/` — facit for hvordan hver side skal se ud (4 desktop + 1 mobil).
3. `design_handoff_cobalt_glass/design-files/*.dc.html` — levende designreferencer. Åbn dem i browser for at se animationer/loading/interaktioner. Al styling ligger inline i HTML'en — du kan slå eksakte værdier op her, når spec'en ikke er nok. Det er REFERENCER, ikke produktionskode: genskab i kodebasens egne mønstre (React-komponenter, Tailwind).
4. Udforsk den eksisterende kodebase FØR du bygger: find eksisterende sider, komponenter, routing og evt. eksisterende design-tokens, så du erstatter frem for at duplikere.

## Arbejdsrækkefølge

**Fase 1 — Fundament**
- [ ] Design tokens ind i Tailwind config / globals.css (sektion 1 i spec'en)
- [ ] Google Fonts: Bricolage Grotesque, Instrument Sans, Instrument Serif, Spline Sans Mono
- [ ] Assets fra `assets/` → `/public/` (app-ikon som favicon)
- [ ] Baggrund: silver + de 3 driftende blur-blobs (genbrugelig layout-komponent)

**Fase 2 — Delte komponenter** (byg som genbrugelige komponenter)
- [ ] `<GlassCard>` — glas-widget (bg/border/blur/shadow/radius fra tokens; varianter: default, red, cobalt)
- [ ] `<Logo>` + `<Wordmark>` — løber-glyf i gradient-brik + "stride"-tekst
- [ ] `<NavBar>` — glas-pill nav med aktiv-state, Coach-link med AI-gnist, sync-knap, avatar
- [ ] `<SyncButton>` — idle/syncing/synced (kobles til rigtig sync-API hvis den findes)
- [ ] `<RunnerLoader>` — logo-loaderen (statisk løber + rullende stiplet vej) + `<LoadingOverlay>` (blur over indhold, nav/hero friholdes). INGEN skeletons.
- [ ] `<IntensityMeter>` — 5-søjlers intensitets-brik (erstatter "Z2"/"Z4"-koder)
- [ ] `<SourceBadge>` — GARMIN/STRAVA-badge med farvet prik
- [ ] `<CountUpNumber>` — tal med count-up + dæmpet pulserende 0-state (dansk talformat)

**Fase 3 — Sider** (én ad gangen, sammenlign med screenshot efter hver)
- [ ] Hjem (dashboard) — bento-grid, se komponent-tabellens kolonnespænd
- [ ] Activities — totaler, filter-chips, aktivitetsrækker
- [ ] Coach — chat-UI + højre kolonne
- [ ] Plan — fase-tidslinje, ugekalender, race-kort
- [ ] Mobil — responsive breakpoints af ovenstående + bund-tab-bar i glas (mobil-referencen viser layoutet i en iPhone-ramme; rammen selv skal IKKE bygges)

**Fase 4 — Finish**
- [ ] Rute-kortet: Leaflet + CARTO tiles (sektion 7), rigtig GPS-polyline fra API hvor muligt
- [ ] Alle entrance-animationer (fadeUp staggered, søjler, graf-linjer, count-up)
- [ ] Loading-flow på alle sider: overlay → fade → count-up trigger
- [ ] Gennemgå hver side mod screenshots pixel-nært

## Vigtige regler

- Navigationen hedder **Hjem** (ikke Dashboard), Activities, Coach, Plan.
- Zone-koder ("Z2", "Z4") må ALDRIG vises — brug klartekst + IntensityMeter (spec sektion 2).
- Instrument Serif bruges ALTID italic og KUN til heroes, widget-overskrifter og citater — aldrig brødtekst.
- Mono-labels er ALTID uppercase med letter-spacing ≥0.14em.
- Ingen skeleton-loaders — kun RunnerLoader/LoadingOverlay.
- Dansk UI-tekst og dansk talformat (komma-decimal).
- Behold eksisterende data-lag/API-kald — det her er et rent UI-redesign.

Start med fase 1, og vis mig tokens + én GlassCard på en testside, før du fortsætter.
