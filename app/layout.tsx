import type { Metadata } from "next";
import { AppHeader } from "@/components/dashboard/app-header";
import { ConditionalAppHeader } from "@/components/dashboard/conditional-app-header";
import { DemoBanner } from "@/components/dashboard/demo-banner";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${instrumentSans.variable} ${instrumentSerif.variable} ${splineMono.variable} h-full antialiased`}
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
