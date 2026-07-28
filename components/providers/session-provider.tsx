"use client";

import type { Session } from "next-auth";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * Wraps next-auth's client SessionProvider so client components can call
 * `useSession()` (which throws without a provider in the tree). The server
 * layout hands in the already-resolved `session`, so the first client render
 * matches the server's and there's no auth flash — the provider only refetches
 * on focus/interval afterwards.
 */
export function SessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return <NextAuthSessionProvider session={session}>{children}</NextAuthSessionProvider>;
}
