import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Email from "next-auth/providers/email";
import authConfig from "@/auth.config";
import { accounts, sessions, users, verificationTokens } from "@/drizzle/schema";
import { getDb } from "@/lib/db";
import { sendVerificationRequest } from "@/lib/email";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // getDb() returns the real Drizzle instance. The exported `db` is a lazy
  // Proxy, which breaks the adapter's `instanceof` dialect detection.
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    ...authConfig.providers,
    Email({
      server: {}, // dummy — we override sendVerificationRequest
      from: "Stride <noreply@stride.run>",
      maxAge: 600, // 10 minutes — matches the email copy
      sendVerificationRequest,
    }),
  ],
});
