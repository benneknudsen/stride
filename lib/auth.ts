import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Email from "next-auth/providers/email";
import authConfig from "@/auth.config";
import { accounts, sessions, users, verificationTokens } from "@/drizzle/schema";
import { getDb } from "@/lib/db";
import { sendVerificationRequest } from "@/lib/email";
import { persistGarminTokens } from "@/lib/garmin/client";
import { captureError } from "@/lib/observability";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // getDb() returns the real Drizzle instance. The exported `db` is a lazy
  // Proxy, which breaks the adapter's `instanceof` dialect detection.
  // Session strategy is JWT (see auth.config.ts), so the adapter never reads or
  // writes `sessionsTable` — it stays wired here only so switching back to
  // database sessions is a one-line config change. `accountsTable` and
  // `verificationTokensTable` are still used (OAuth linking + magic-link tokens).
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
  events: {
    /**
     * Garmin's OAuth tokens are also its *data* tokens — the Activity API reads
     * with the same bearer the sign-in produced. The Drizzle adapter writes them
     * into `accounts` in plaintext, which this codebase does not allow for
     * provider tokens, so mirror them into `garmin_tokens` encrypted at rest
     * (issue #35) and record the athlete's Garmin user id on the user row, which
     * is how the webhook resolves a push notification back to an owner.
     *
     * `signIn` rather than `linkAccount`: linkAccount only fires the first time
     * an account is attached, while a re-authorize (after the ~3-month refresh
     * token expires) has to overwrite the dead tokens.
     *
     * Best-effort — a failure here must not take down the sign-in itself. The
     * user lands authenticated but with Garmin showing "not connected", which is
     * the honest state and is fixed by reconnecting.
     */
    async signIn({ user, account }) {
      if (account?.provider !== "garmin" || !user.id || !account.access_token) return;

      try {
        const nowSeconds = Math.floor(Date.now() / 1000);
        // Auth.js normalises the provider's relative `expires_in` into an
        // absolute `expires_at`; persistGarminTokens wants Garmin's own relative
        // form, so convert back. `refresh_token_expires_in` is not part of the
        // OAuth spec, so Auth.js passes it through untouched on the account.
        const refreshExpiresIn = (account as { refresh_token_expires_in?: number })
          .refresh_token_expires_in;

        await persistGarminTokens(user.id, {
          access_token: account.access_token,
          refresh_token: account.refresh_token ?? "",
          token_type: account.token_type ?? "Bearer",
          expires_in:
            typeof account.expires_at === "number"
              ? Math.max(0, account.expires_at - nowSeconds)
              : 24 * 60 * 60,
          refresh_token_expires_in: refreshExpiresIn,
          scope: account.scope,
        });

        await getDb()
          .update(users)
          .set({ garminUserId: account.providerAccountId, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      } catch (error) {
        // Log-safe: captureError serialises only name/message/cause, never the
        // raw thrown value, so a DB/crypto failure here cannot spill token or
        // connection fields into the logs (issue #143).
        captureError("auth.signIn.persistGarminTokens", error);
      }
    },
  },
});
