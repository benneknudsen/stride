"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { ROUTES } from "@/lib/routes";

type OAuthProvider = "google" | "garmin";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailLoading(true);
    try {
      const result = await signIn("email", { email, redirect: false });
      if (result?.error) {
        setError("Kunne ikke sende magic link. Prøv igen.");
      } else {
        setEmailSent(true);
      }
    } catch {
      setError("Noget gik galt. Prøv igen.");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setOauthLoading(provider);
    try {
      await signIn(provider, { callbackUrl: "/" });
    } catch {
      setError("Noget gik galt. Prøv igen.");
      setOauthLoading(null);
    }
  }

  const busy = emailLoading || oauthLoading !== null;

  return (
    <div className="w-full max-w-[360px]">
      {/* Cobalt Glass card */}
      <div className="rounded-card border border-cobalt/10 bg-white/60 p-8 shadow-glass backdrop-blur-xl">
        <h1 className="mb-1 font-cg-sans text-[22px] font-bold leading-tight tracking-tight text-cobalt">
          Log ind
        </h1>
        <p className="mb-6 text-[14px] leading-relaxed text-ink">Din løbecoach venter på dig.</p>

        {emailSent ? (
          <div className="rounded-card border border-cobalt/15 bg-cobalt/[0.04] px-4 py-3 text-[14px] text-cobalt">
            Tjek din email — vi har sendt et magic link.
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="din@email.dk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="w-full rounded-card border border-cobalt/15 bg-white px-4 py-2.5 text-[16px] text-cobalt placeholder:text-ink/40 outline-none transition-colors focus:border-cobalt/40 sm:text-[14px]"
            />
            <button
              type="submit"
              disabled={busy || !email}
              className="cg-interactive flex w-full items-center justify-center gap-2 rounded-card bg-cobalt px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {emailLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Sender…
                </>
              ) : (
                "Send magic link"
              )}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {error}
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-cobalt/10" />
          <span className="text-[11px] uppercase tracking-widest text-ink/40">eller</span>
          <span className="h-px flex-1 bg-cobalt/10" />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => handleOAuth("google")}
          className="cg-interactive flex w-full items-center justify-center gap-2 rounded-card border border-cobalt/15 bg-white px-4 py-2.5 text-[14px] font-medium text-cobalt transition-colors hover:bg-cobalt/[0.03] disabled:opacity-50"
        >
          {oauthLoading === "google" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Fortsæt med Google
        </button>

        {/* Garmin (#35). Signing in here also grants the Activity API scope, so
            the athlete's runs start syncing without a second connect step. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => handleOAuth("garmin")}
          className="cg-interactive mt-3 flex w-full items-center justify-center gap-2 rounded-card border border-cobalt/15 bg-white px-4 py-2.5 text-[14px] font-medium text-cobalt transition-colors hover:bg-cobalt/[0.03] disabled:opacity-50"
        >
          {oauthLoading === "garmin" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <GarminIcon />
          )}
          Fortsæt med Garmin
        </button>

        <p className="mt-6 text-center text-[13px] text-ink/60">
          Kigger du bare?{" "}
          <Link
            href={ROUTES.HOME}
            className="cg-interactive font-semibold text-cobalt hover:underline"
          >
            Prøv demoen
          </Link>
        </p>
      </div>
    </div>
  );
}

function GarminIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <title>Garmin</title>
      <path
        fill="var(--color-garmin)"
        d="M12 1.7 22.3 12 12 22.3 1.7 12 12 1.7Zm0 3.2L4.9 12l7.1 7.1 7.1-7.1L12 4.9Z"
      />
      <circle cx="12" cy="12" r="2.6" fill="var(--color-garmin)" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3a7.2 7.2 0 0 1-4.07 1.16 7.17 7.17 0 0 1-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3a7.18 7.18 0 0 1 0-4.6V6.62H1.28a12 12 0 0 0 0 10.77l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.28 6.62l3.99 3.09A7.17 7.17 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
