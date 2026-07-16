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
 * uden session; demoen (#84) bor på den rene sti `/demo`, som next.config.ts
 * rewriter internt til `/?demo=1` — én side, to stier, ingen duplikat-rute
 * (#100). Login-sidens "Prøv demoen" og besøgendes Hjem-tab peger her, og
 * gamle `/?demo=1`-links virker stadig direkte. Signede brugere ignorerer
 * demoen; de ser altid deres egne data.
 */
export const DEMO_HOME_ROUTE = "/demo";

/**
 * Den interne form af {@link DEMO_HOME_ROUTE}: query-parameteren forsiden
 * faktisk læser. Kun rewriten (next.config.ts) og tests bør pege her — alle
 * links bruger den rene sti.
 */
export const DEMO_HOME_REWRITE_TARGET = "/?demo=1";

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
