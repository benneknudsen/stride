import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import {
  GARMIN_API_BASE,
  GARMIN_AUTHORIZATION_URL,
  GARMIN_SCOPE,
  GARMIN_TOKEN_URL,
} from "@/lib/garmin/config";

const isDev = process.env.NODE_ENV === "development";

/** `GET /user/id` is the whole of Garmin's "profile" — there is no name or email. */
type GarminProfile = { userId: string };

/**
 * Garmin Connect — OAuth 2.0 PKCE (issue #35).
 *
 * `checks: ["pkce", "state"]` is what makes this a PKCE flow: Auth.js mints the
 * code_verifier, sends its S256 challenge on the authorize leg, replays the
 * verifier on the token leg, and validates the CSRF state — so the flow needs no
 * hand-rolled cookie dance like the Strava connect action has.
 *
 * Two places Garmin departs from a stock OAuth 2 provider:
 *
 *  - **Auth method.** Garmin wants `client_id`/`client_secret` in the form body;
 *    Auth.js defaults to HTTP Basic, which Garmin's token endpoint rejects.
 *  - **No identity.** Garmin returns *only* an opaque `userId` — no email, ever.
 *    `users.email` is NOT NULL (it is the account's natural key), so a Garmin-only
 *    sign-in gets a routable-looking but undeliverable placeholder, the same
 *    convention GitHub uses for private-email users. An athlete who signs in with
 *    Garmin and later wants email/Google can link those to the same account.
 *
 * The tokens this provider returns are the *data* tokens for the Activity API.
 * NextAuth's adapter would park them in `accounts` in plaintext; `lib/auth.ts`
 * copies them into `garmin_tokens` encrypted (AES-256-GCM) on every sign-in.
 */
const providers: NextAuthConfig["providers"] = [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
  {
    id: "garmin",
    name: "Garmin",
    type: "oauth",
    clientId: process.env.GARMIN_CLIENT_ID,
    clientSecret: process.env.GARMIN_CLIENT_SECRET,
    authorization: {
      url: GARMIN_AUTHORIZATION_URL,
      params: { response_type: "code", scope: GARMIN_SCOPE },
    },
    token: { url: GARMIN_TOKEN_URL },
    userinfo: { url: `${GARMIN_API_BASE}/user/id` },
    checks: ["pkce", "state"],
    client: { token_endpoint_auth_method: "client_secret_post" },
    profile(profile: GarminProfile) {
      return {
        id: profile.userId,
        name: "Garmin-bruger",
        email: `garmin_${profile.userId}@users.noreply.stride.run`,
        image: null,
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
