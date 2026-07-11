import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/providers/theme-provider";
import {
  bricolage,
  geistMono,
  geistSans,
  instrumentSans,
  instrumentSerif,
  spaceGrotesk,
  splineMono,
} from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride — AI-Powered Running Dashboard",
  description: "Visualize your running data with AI-powered insights",
  icons: {
    icon: "/app-icon.svg",
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
      className={`${spaceGrotesk.variable} ${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${instrumentSans.variable} ${instrumentSerif.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gradient-to-br from-bg to-bg-2">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
