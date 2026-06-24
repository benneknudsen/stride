import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(credentials) {
        const username = credentials.username as string;
        const password = credentials.password as string;
        if (username === "demo" && password === "demo") {
          const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, "demo@run-dashboard.local"));
          if (existing.length > 0)
            return { id: existing[0].id, email: existing[0].email, name: existing[0].name };
          const created = await db
            .insert(users)
            .values({ email: "demo@run-dashboard.local", name: "Demo User" })
            .returning();
          return { id: created[0].id, email: created[0].email, name: created[0].name };
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
