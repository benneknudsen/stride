import type { Metadata } from "next";
import { AppHeader } from "@/components/dashboard/app-header";
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
      className={`${spaceGrotesk.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gradient-to-br from-bg to-bg-2">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
