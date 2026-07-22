import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { bricolage, instrumentSans, instrumentSerif, splineMono } from "@/lib/fonts";
import "./globals.css";

// Absolute URLs for og:image/twitter:image resolve against metadataBase.
// VERCEL_PROJECT_PRODUCTION_URL is bare (no protocol) and set in every Vercel
// environment; the localhost fallback matches `npm run dev` (port 6969).
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:6969";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Stride — AI-Powered Running Dashboard",
  description: "Visualize your running data with AI-powered insights",
  icons: {
    icon: "/app-icon.svg",
  },
  // The card image itself comes from app/opengraph-image.tsx — Next wires it
  // into og:image and twitter:image automatically.
  openGraph: {
    type: "website",
    siteName: "Stride",
    locale: "da_DK",
    url: "/",
    title: "Stride — AI-Powered Running Dashboard",
    description: "Al din løbedata. Én coach, der forstår den.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stride — AI-Powered Running Dashboard",
    description: "Al din løbedata. Én coach, der forstår den.",
  },
};

// viewport-fit=cover lets the Cobalt Glass mobile shell read the iOS safe-area
// insets (env(safe-area-inset-*)) so the topbar clears the status bar and the
// floating tab bar clears the home indicator.
export const viewport: Viewport = {
  viewportFit: "cover",
};

/**
 * Next.js stamps its own scripts with the CSP nonce automatically, but next-themes'
 * anti-FOUC script is hand-rolled inline HTML, so it has to be handed the nonce
 * explicitly or `'strict-dynamic'` blocks it (issue #89). `proxy.ts` puts the nonce
 * on the request as `x-nonce`.
 *
 * Reading `headers()` opts every route out of static prerendering — which the nonce
 * requires anyway: prerendered HTML is built once, so it could not carry a
 * per-request nonce and all of its scripts would be blocked.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="da"
      suppressHydrationWarning
      className={`${bricolage.variable} ${instrumentSans.variable} ${instrumentSerif.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gradient-to-br from-bg to-bg-2">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
