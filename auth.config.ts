import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const isDev = process.env.NODE_ENV === "development";

/**
 * Strava's `GET /athlete` shape — the fields we read for the NextAuth profile.
 * Strava no longer returns an email on this endpoint, so we mint a placeholder
 * (see the provider's `profile` below).
 */
type StravaAthleteProfile = {
  id: number;
  firstname: string | null;
  lastname: string | null;
  profile_medium: string | null;
  profile: string | null;
};

const providers: NextAuthConfig["providers"] = [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
  {
    /**
     * Strava — OAuth 2.0 PKCE (issue #183).
     *
     * Strava is a *data source* first: the connect flow in `actions/strava.ts`
     * links it to an already-authenticated account. This provider makes Strava
     * *also* an optional sign-in — the tokens it returns are the same Activity
     * API tokens, which `lib/auth.ts` mirrors into `strava_tokens` encrypted
     * (AES-256-GCM) and whose athlete id it records on the user, exactly like the
     * connect action does, so a Strava sign-in lands connected and syncable.
     *
     * Two Strava-specific departures from a stock OAuth 2 provider:
     *  - **Auth method.** Strava wants `client_id`/`client_secret` in the form
     *    body (`client_secret_post`), not HTTP Basic.
     *  - **No identity.** `GET /athlete` returns no email, so a Strava-only
     *    sign-in gets a routable-looking placeholder for the NOT NULL
     *    `users.email`; the athlete can link email/Google to the same account.
     */
    id: "strava",
    name: "Strava",
    type: "oauth",
    clientId: process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    authorization: {
      url: "https://www.strava.com/oauth/authorize",
      params: { response_type: "code", approval_prompt: "auto", scope: "read,activity:read_all" },
    },
    token: { url: "https://www.strava.com/oauth/token" },
    userinfo: { url: "https://www.strava.com/api/v3/athlete" },
    checks: ["pkce", "state"],
    client: { token_endpoint_auth_method: "client_secret_post" },
    profile(profile: StravaAthleteProfile) {
      const name = [profile.firstname, profile.lastname].filter(Boolean).join(" ").trim();
      return {
        id: String(profile.id),
        name: name || "Strava-bruger",
        email: `strava_${profile.id}@users.noreply.stride.run`,
        image: profile.profile_medium ?? profile.profile ?? null,
      };
    },
  },
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
  /**
   * Trust the deployment's `Host`/`X-Forwarded-Host` header explicitly (issue
   * #143). Auth.js otherwise *infers* this, defaulting to `true` only when it
   * recognises the platform — `VERCEL`/`AUTH_URL`/`AUTH_TRUST_HOST`/`CF_PAGES`
   * set, or `NODE_ENV !== "production"` (see @auth/core `setEnvDefaults`). A
   * self-hosted production build sets none of those, so the inference lands on
   * `false` and every request fails `assertConfig` with `UntrustedHost` — the
   * edge proxy's session read included, since it runs that check before any
   * action. Pinning it here hardens *both* auth instances built from this config
   * (the edge one in proxy.ts and the Node one in lib/auth.ts that spreads it).
   *
   * Set `AUTH_URL` to the canonical origin in production (see .env.example): when
   * present, Auth.js builds callback and magic-link URLs from it and ignores the
   * request host, which neutralises host-header spoofing even with trust on. As
   * defence in depth, `assertTrustedMagicLinkUrl` in lib/email.ts refuses to send
   * a magic link whose host is not `AUTH_URL`'s in production (issue #168).
   */
  trustHost: true,
  callbacks: {
    /**
     * Session-fixation mitigation. On initial sign-in (`user` present) and on
     * explicit session updates (`trigger === "update"`), mint a fresh, random
     * session id (`sid`). NextAuth re-signs the JWT cookie whenever the token
     * changes, so rotating `sid` forces the underlying session-token cookie to
     * rotate at the authentication boundary — a token fixed before login can
     * never be elevated into an authenticated one.
     */
    async jwt({ token, user, trigger }) {
      if (user || trigger === "update") {
        token.sid = crypto.randomUUID();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
