// Stride — font loading with next/font/google
import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Instrument_Sans,
  Instrument_Serif,
  Space_Grotesk,
  Spline_Sans_Mono,
} from "next/font/google";

// ── Legacy "Volt" design system ──
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const geistSans = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

// ── Cobalt Glass design system ──
// Bricolage Grotesque — display: store tal + titler
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

// Instrument Sans — brødtekst / UI
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

// Instrument Serif — heroes / widget-overskrifter / citater (ALTID italic).
// Non-variable font, so weight is required; both styles loaded for safety.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// Spline Sans Mono — labels / data
export const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
});
