import { ImageResponse } from "next/og";

// Open Graph card (#120) — the Velkommen hero rendered as a 1200×630 social
// image: wordmark + logo tile on top, the serif-italic tagline in the middle,
// the stack line as footer. Statically generated at build time.

export const alt = "Stride — Al din løbedata. Én coach, der forstår den.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Cobalt Glass tokens, mirrored from the @theme block in app/globals.css —
// the OG route renders outside the CSS pipeline, so var(--color-*) can't reach it.
const COBALT = "#1b29c0";
const COBALT_LIGHT = "#2536d8";
const COBALT_DARK = "#131f96";
const RED = "#ee2418";
const SILVER = "#e9eae5";
const SILVER_DARK = "#dde0ec";
const INK = "#5560a8";

const KICKER = "AI-DREVET LØBETRÆNING";
const TAGLINE = ["Al din løbedata.", "Én coach, der forstår den."];
const FOOTER = "NEXT.JS · TYPESCRIPT · DRIZZLE · VERCEL AI SDK";

// next/font can't run inside an OG route, so the fonts are fetched from the
// Google Fonts css2 API instead — the `text=` param subsets each file to the
// exact glyphs the card renders, keeping the payload tiny.
async function loadGoogleFont(family: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);
  if (!resource) {
    throw new Error(`opengraph-image: no font URL in css2 response for ${family}`);
  }
  const response = await fetch(resource[1]);
  if (!response.ok) {
    throw new Error(`opengraph-image: font fetch failed for ${family} (${response.status})`);
  }
  return response.arrayBuffer();
}

export default async function OpengraphImage() {
  const [bricolage, instrumentSerifItalic, splineMono] = await Promise.all([
    loadGoogleFont("Bricolage+Grotesque:wght@700", "stride"),
    loadGoogleFont("Instrument+Serif:ital@1", TAGLINE.join("")),
    loadGoogleFont("Spline+Sans+Mono:wght@500", `${KICKER}${FOOTER}`),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: `linear-gradient(135deg, ${SILVER}, ${SILVER_DARK})`,
      }}
    >
      {/* Wordmark row — the nav's logo tile + lowercase Bricolage wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 76,
            height: 76,
            borderRadius: 24,
            background: `linear-gradient(150deg, ${COBALT_LIGHT}, ${COBALT_DARK})`,
          }}
        >
          {/* RunnerGlyph paths, verbatim from components/cobalt/RunnerGlyph.tsx */}
          <svg width="47" height="47" viewBox="0 0 100 100" fill="none" aria-hidden="true">
            <circle cx="74" cy="17" r="11" fill={RED} />
            <path
              d="M66 32 L44 50 L60 62 L40 88"
              stroke={SILVER}
              strokeWidth="13"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M44 50 L22 62 L8 56"
              stroke={SILVER}
              strokeWidth="11"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.55"
            />
            <path
              d="M64 40 L86 50"
              stroke={SILVER}
              strokeWidth="11"
              strokeLinecap="round"
              opacity="0.55"
            />
          </svg>
        </div>
        <div
          style={{
            fontFamily: "Bricolage Grotesque",
            fontSize: 54,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: COBALT,
          }}
        >
          stride
        </div>
      </div>

      {/* Hero tagline — same copy and serif-italic voice as VelkommenPage */}
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            fontFamily: "Spline Sans Mono",
            fontSize: 21,
            fontWeight: 500,
            letterSpacing: "0.22em",
            color: RED,
          }}
        >
          {KICKER}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Instrument Serif",
            fontStyle: "italic",
            fontSize: 78,
            lineHeight: 1.08,
            letterSpacing: "-0.015em",
            color: COBALT,
          }}
        >
          <div>{TAGLINE[0]}</div>
          <div>{TAGLINE[1]}</div>
        </div>
      </div>

      {/* Stack line — the landing page's footer, mono and muted */}
      <div
        style={{
          fontFamily: "Spline Sans Mono",
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "0.18em",
          color: INK,
          opacity: 0.75,
        }}
      >
        {FOOTER}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Bricolage Grotesque", data: bricolage, weight: 700, style: "normal" },
        { name: "Instrument Serif", data: instrumentSerifItalic, weight: 400, style: "italic" },
        { name: "Spline Sans Mono", data: splineMono, weight: 500, style: "normal" },
      ],
    }
  );
}
