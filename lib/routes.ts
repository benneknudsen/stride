// Samtlige app-ruter på ét sted — én kilde til sandhed.
// Ændringer her opdaterer automatisk NavBar, BottomTabBar, proxy og pages.

export const ROUTES = {
  HOME: "/",
  AKTIVITETER: "/aktiviteter",
  COACH: "/coach",
  PLAN: "/plan",
  DASHBOARD: "/dashboard",
  DASHBOARD_COACH: "/dashboard/coach",
  DEMO: "/demo",
  // Login-siden ligger i route-gruppen app/(auth)/login → URL'en er /login.
  LOGIN: "/login",
} as const;

export type RouteKey = keyof typeof ROUTES;
