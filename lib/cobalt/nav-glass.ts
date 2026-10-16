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
 *
 * Kanten er transparent, ikke hvid (#322-opfølgningen): glasflader bærer
 * deres afgrænsning i cobalt-skyggen, og den hvide pille-kant var det sidste
 * hvide bånd i systemet. Den aktive fane skelnes i stedet via den lysere
 * glasflade, den styrkede cobalt-skygge og den semibold label. Fyldet er
 * 0,75 frem for 0,70: ved 390 px måler den aktive fane dermed ΔL ~0,09 mod
 * nabofanen og ~0,15 mod bar-pladen — begge løftet ~0,01 over 0,70, og
 * cobalt-labelen holder ~9:1 på den aktive flade.
 */
export function glassTabStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0)",
    borderColor: "transparent",
    backdropFilter: active ? "blur(12px)" : "none",
    WebkitBackdropFilter: active ? "blur(12px)" : "none",
    boxShadow: active
      ? "0 4px 16px rgba(27,41,192,0.16), 0 2px 6px rgba(27,41,192,0.12)"
      : "0 0 0 rgba(27,41,192,0)",
  };
}
