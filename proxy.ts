import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Build an edge-safe auth instance from the config that excludes nodemailer and
// the Drizzle adapter. The full instance lives in lib/auth.ts (Node runtime).
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;

  // Authenticated users have no reason to see the login page.
  if (isAuthed && pathname === "/login") {
    return Response.redirect(new URL("/", req.nextUrl));
  }

  // Protect the dashboard (root) and everything under /dashboard.
  const isProtected = pathname === "/" || pathname.startsWith("/dashboard");
  if (!isAuthed && isProtected) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login"],
};
