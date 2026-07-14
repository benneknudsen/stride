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
  // Login-siden ligger i route-gruppen app/(auth)/login → URL'en er /login.
  LOGIN: "/login",
} as const;

/**
 * Demo-dashboardet som destination. Forsiden viser velkomstsiden for besøgende
 * uden session, så demoen (#84) nås via `?demo=1` på samme rute — login-sidens
 * "Prøv demoen" og besøgendes Hjem-tab peger her. Signede brugere ignorerer
 * parameteren; de ser altid deres egne data.
 */
export const DEMO_HOME_ROUTE = "/?demo=1";

/**
 * Den gamle coach-rute. Ingen interne links peger her længere; den lever kun som
 * kilde for den permanente redirect til {@link ROUTES.COACH} (next.config.ts),
 * så bogmærker og delte links stadig virker.
 */
export const LEGACY_COACH_ROUTE = "/coach";

/**
 * Den gamle demo-forside. Issue #100 fjernede auth-gaten fra de fire hovedsider —
 * de har alle demo-fallback (#84) — så en separat demo-rute var en duplikat af
 * forsiden, og BottomTabBar/NavBar kunne ikke markere en aktiv tab på den. Lever
 * nu kun som kilde for den permanente redirect til {@link ROUTES.HOME}.
 */
export const LEGACY_DEMO_ROUTE = "/demo";

/**
 * Detalje-siden for én aktivitet (issue #92) — `/aktiviteter/<id>`. Id'et kommer
 * fra databasen (cuid) eller demo-fixtures ("demo-01"), så det er url-sikkert;
 * `encodeURIComponent` er en billig garanti for at det bliver ved med at være det.
 */
export function activityRoute(id: string): string {
  return `${ROUTES.AKTIVITETER}/${encodeURIComponent(id)}`;
}

export type RouteKey = keyof typeof ROUTES;
