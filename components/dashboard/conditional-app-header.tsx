"use client";

import { usePathname } from "next/navigation";

// The login route renders inside the root layout, so the global AppHeader would
// otherwise leak onto the auth pages. Skip it there to keep login clean. The
// Cobalt Glass redesign (app/(cobalt)/*) ships its own glass NavBar, so the
// legacy header is suppressed on those routes too while both designs coexist.
//
// AppHeader is an async Server Component (it calls auth() + nodemailer-backed
// code transitively). It must NOT be imported here — importing a Server
// Component into a "use client" module pulls its whole server tree into the
// browser bundle and breaks the build. Instead it's passed in as children,
// rendered on the server and handed to us as an already-serialized element.
const COBALT_ROUTES = ["/test-cobalt", "/hjem", "/activities", "/coach", "/plan"];

export function ConditionalAppHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!pathname) return <>{children}</>;
  if (pathname.startsWith("/login")) return null;
  if (COBALT_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return null;
  }
  return <>{children}</>;
}
