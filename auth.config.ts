import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const isDev = process.env.NODE_ENV === "development";

const providers: NextAuthConfig["providers"] = [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
];

// Dev login — bypass OAuth for local development without API keys
if (isDev) {
  providers.push(
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(credentials) {
        if (credentials.username === "dev" && credentials.password === "dev") {
          return {
            id: "dev-user",
            email: "dev@stride.local",
            name: "Dev User",
          };
        }
        return null;
      },
    })
  );
}

/**
 * Edge-safe auth config. Contains only providers and callbacks that can run in
 * the Edge runtime (middleware). The Email provider (nodemailer) and the
 * Drizzle adapter live in lib/auth.ts, which only loads in the Node runtime.
 *
 * In development, a Credentials provider (dev/dev) is added so you can log in
 * without setting up OAuth apps or a Resend API key.
 */
const authConfig = {
  providers,
  session: { strategy: "jwt" as const },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
