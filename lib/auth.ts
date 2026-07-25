import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { accounts, sessions, users, verificationTokens } from "@/drizzle/schema";
import { encrypt } from "@/lib/crypto";
import { db, getDb } from "@/lib/db";
import { upsertStravaTokens } from "@/lib/db/queries";
import { captureError } from "@/lib/observability";
import { syncStravaActivities } from "@/lib/strava/sync";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // getDb() returns the real Drizzle instance. The exported `db` is a lazy
  // Proxy, which breaks the adapter's `instanceof` dialect detection.
  // Session strategy is JWT (see auth.config.ts), so the adapter never reads or
  // writes `sessionsTable` — it stays wired here only so switching back to
  // database sessions is a one-line config change. `accountsTable` is still used
  // for OAuth account linking; `verificationTokensTable` stays wired for the
  // adapter contract.
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [...authConfig.providers],
  events: {
    /**
     * Strava sign-in parity (issue #188).
     *
     * A Strava *login* (`signIn("strava")`) and the Strava *connect* action
     * (`handleStravaCallback` in `actions/strava.ts`) must leave the account in
     * the same state: tokens mirrored into `strava_tokens` (AES-256-GCM), the
     * athlete id recorded on the user, and an initial sync kicked off. The
     * connect action already does this; before #188 the login path stored the
     * OAuth tokens only in NextAuth's `accounts` table — which the Activity API
     * client never reads — so a Strava-login user landed disconnected and saw
     * demo data instead of their own runs.
     *
     * This event closes that gap without touching the connect action: it mirrors
     * the exact same three steps here, off the tokens NextAuth already exchanged.
     * Runs only in the Node runtime (this module carries the adapter and is never
     * loaded into the edge proxy), so `node:crypto` and the DB driver are safe.
     */
    async signIn({ user, account }) {
      // Only the Strava OAuth provider carries Activity API tokens. The dev
      // Credentials provider (and any future non-Strava provider) is ignored.
      if (account?.provider !== "strava") return;

      // The adapter assigns the user its DB id before this event fires. Without
      // it there is no row to attach tokens to.
      const userId = user.id;
      if (!userId) return;

      // NextAuth stashes the freshly-exchanged OAuth tokens on `account`. Guard
      // both the identity (athlete id) and the access token — a malformed token
      // response would otherwise write an unusable half-row.
      if (!account.providerAccountId || !account.access_token) return;

      try {
        // Encrypt both tokens together under a single IV so decryption is
        // consistent — separate encrypt() calls would produce mismatched IVs and
        // break refresh-token decryption. Same shape as handleStravaCallback.
        const blob = encrypt(
          JSON.stringify({
            access_token: account.access_token,
            refresh_token: account.refresh_token ?? "",
          })
        );

        // Upsert so a repeat sign-in (or a later connect) overwrites the row
        // rather than violating the unique(user_id) constraint.
        await upsertStravaTokens({
          userId,
          accessTokenEnc: blob.encrypted,
          refreshTokenEnc: "", // unused — both tokens live in accessTokenEnc
          iv: blob.iv,
          authTag: blob.authTag,
          expiresAt: new Date((account.expires_at ?? 0) * 1000),
          scope: account.scope ?? "read,activity:read_all",
        });

        // Link the Strava athlete id so the dashboard shows "connected".
        const athleteId = Number(account.providerAccountId);
        if (!Number.isNaN(athleteId)) {
          await db
            .update(users)
            .set({ stravaAthleteId: athleteId, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }

        // Best-effort initial sync so the dashboard has real data immediately.
        // A sync failure (rate limit, transient error) must not fail the sign-in
        // — the tokens are already stored, and the webhook/manual re-sync backfill
        // anything missed here.
        try {
          await syncStravaActivities(userId);
        } catch (err) {
          captureError("auth.events.signIn.initialSync", err);
        }
      } catch (err) {
        // Mirroring failed (encrypt / token upsert / athlete link). Never let it
        // surface as a failed sign-in — the user is authenticated regardless;
        // they can re-trigger a sync via the connect flow.
        captureError("auth.events.signIn.mirrorTokens", err);
      }
    },
  },
});
