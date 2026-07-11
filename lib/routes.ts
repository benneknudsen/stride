// Samtlige app-ruter på ét sted — én kilde til sandhed.
// Ændringer her opdaterer automatisk NavBar, BottomTabBar, proxy og pages.

export const ROUTES = {
  HOME: "/",
  AKTIVITETER: "/aktiviteter",
  // Issue #86: coachen havde to overlappende ruter. Den her er den eneste —
  // NavBar og BottomTabBar peger på den, så tab-markøren rammer rigtigt.
  COACH: "/dashboard/coach",
  PLAN: "/plan",
  DASHBOARD: "/dashboard",
  DEMO: "/demo",
  // Login-siden ligger i route-gruppen app/(auth)/login → URL'en er /login.
  LOGIN: "/login",
} as const;

/**
 * Den gamle coach-rute. Ingen interne links peger her længere; den lever kun som
 * kilde for den permanente redirect til {@link ROUTES.COACH} (next.config.ts),
 * så bogmærker og delte links stadig virker.
 */
export const LEGACY_COACH_ROUTE = "/coach";

/**
 * Detalje-siden for én aktivitet (issue #92) — `/aktiviteter/<id>`. Id'et kommer
 * fra databasen (cuid) eller demo-fixtures ("demo-01"), så det er url-sikkert;
 * `encodeURIComponent` er en billig garanti for at det bliver ved med at være det.
 */
export function activityRoute(id: string): string {
  return `${ROUTES.AKTIVITETER}/${encodeURIComponent(id)}`;
}

export type RouteKey = keyof typeof ROUTES;
