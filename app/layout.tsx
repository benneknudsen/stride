import type { Metadata } from "next";
import { AppHeader } from "@/components/dashboard/app-header";
import { ConditionalAppHeader } from "@/components/dashboard/conditional-app-header";
import { DemoBanner } from "@/components/dashboard/demo-banner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { geistMono, geistSans, spaceGrotesk } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride — AI-Powered Running Dashboard",
  description: "Visualize your running data with AI-powered insights",
  icons: {
    icon: "/stride-app-icon-dark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gradient-to-br from-bg to-bg-2">
        <ThemeProvider>
          <ConditionalAppHeader>
            <AppHeader />
          </ConditionalAppHeader>
          <DemoBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
