import type { Metadata, Viewport } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="da"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${instrumentSans.variable} ${instrumentSerif.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gradient-to-br from-bg to-bg-2">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
