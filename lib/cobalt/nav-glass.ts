import type { CSSProperties } from "react";

/**
 * Den flydende glas-baggrund der markerer den aktive tab i NavBar og
 * BottomTabBar (issue #100). Delt herfra, så de to barer aldrig kommer til at
 * markere "aktiv" på hver sin måde.
 *
 * Værdierne ligger som inline style og ikke som en `cg-*`-utility med vilje:
 * inaktiv skal have *samme* egenskaber med gennemsigtige værdier, ellers er der
 * ikke noget for `transition-all` at interpolere imellem — glasset ville
 * poppe frem i stedet for at flyde. Borderen er derfor altid til stede (kun
 * farven skifter), så den aktive tab heller ikke rykker en pixel i layoutet.
 */
export function glassTabStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0)",
    borderColor: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0)",
    backdropFilter: active ? "blur(12px)" : "none",
    WebkitBackdropFilter: active ? "blur(12px)" : "none",
    boxShadow: active ? "0 4px 16px rgba(27,41,192,0.10)" : "0 0 0 rgba(27,41,192,0)",
  };
}
