# Performance measurements

Reproducible Lighthouse runs for Stride. The tooling collects reports and extracts a
small, whitelisted summary. It does not judge them: there is no assertion budget, so a
collection run cannot fail on a score.

## Pages

Every configuration measures the same public surfaces:

- `/` — the signed-out landing page
- `/demo` — the public demo dashboard
- `/aktiviteter` — the public activities view
- `/plan` — the public plan view
- `/dashboard/coach` — the coach view reached by signed-out visitors
- `/login` — the sign-in page

Signed-out pages render the demo fixtures (`lib/demo/data.ts`), so they are measurable
without a session.

## Presets

- `lighthouserc.cjs` — Lighthouse's default mobile preset.
- `lighthouserc.desktop.cjs` — `settings.preset: "desktop"`.
- `lighthouserc.auth.cjs` — the mobile configuration plus a Puppeteer script that loads a
  Playwright storage state, for signed-in pages.

Each configuration runs every URL the configured number of times and reports the median
per URL, not the best or worst run.

## Environments

Set `LHCI_BASE_URL` to measure an already-running server. When it is unset the config
starts a local production build itself (`npm start`, with `AUTH_URL` pointed at the local
base URL) and stops it afterwards. Build before collecting locally:

```bash
npm run build
npm run perf:lhci
npm run perf:lhci:desktop
```

For production, run the same commands with `LHCI_BASE_URL` pointing at the deployment and
leave `startServerCommand` unused.

Reports land under `.lighthouseci/out` unless `LHCI_OUT` says otherwise. That directory is
gitignored.

## Signed-in measurements

Signed-in reports are private. They may contain account-specific page text, so only the
extracted summary may be committed, and only under a private directory that is ignored by
git (`docs/performance/**/private/`).

Create a storage state by hand — no credentials live in the repository:

```bash
PERF_BASE_URL=<deployment-url> npm run perf:session
```

A headed browser opens the login page and waits until the URL leaves `/login`. The user
signs in themselves; the script then saves the storage state to `.perf-auth/prod.json`.

Run the signed-in collection with that state:

```bash
PERF_STORAGE_STATE=.perf-auth/prod.json LHCI_BASE_URL=<deployment-url> npm run perf:lhci:auth
```

The Puppeteer script reads only the cookies from the storage state and never prints them.

## Extracting results

```bash
npm run perf:extract -- .lighthouseci/out [summary.json]
```

The extractor reads every Lighthouse report in the input directory and writes one
`summary.json`. Per URL it keeps only:

- the requested URL path, without query string
- `fetchTime` and `lighthouseVersion` from the most recent run
- median category scores for performance, accessibility, best practices and SEO
- median `numericValue` for largest contentful paint, cumulative layout shift, total
  blocking time, first contentful paint and speed index

No audit `details`, screenshots, DOM snippets or page text are copied into the summary.

## Reading results

Compare the same URL from the same preset and the same environment. A difference smaller
than the spread across that URL's runs is "within noise" and is not a regression. Change
one thing at a time, and re-measure rather than comparing a local build against production
or a mobile run against a desktop run.
