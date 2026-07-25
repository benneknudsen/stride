"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { DEMO_HOME_ROUTE } from "@/lib/routes";

type OAuthProvider = "strava";

export default function LoginPage() {
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const busy = oauthLoading !== null;

  return (
    <div className="w-full max-w-[360px]">
      {/* Cobalt Glass card */}
      <div className="rounded-card border border-cobalt/10 bg-white/60 p-8 shadow-glass backdrop-blur-xl">
        <RunnerGlyph
          size={40}
          stroke="var(--color-cobalt)"
          head="var(--color-red)"
          title="Stride"
          className="mx-auto mb-5"
        />
        <h1 className="mb-1 font-cg-sans text-[22px] font-bold leading-tight tracking-tight text-cobalt">
          Log ind
        </h1>
        <p className="mb-6 text-[14px] leading-relaxed text-ink">Din løbecoach venter på dig.</p>

        <button
          type="button"
          disabled={busy}
          onClick={() => handleOAuth("strava")}
          className="cg-interactive flex w-full items-center justify-center gap-2 rounded-card bg-[#fc4c02] px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {oauthLoading === "strava" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <StravaIcon />
          )}
          Log ind med Strava
        </button>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-[13px] text-ink/60">
          Kigger du bare?{" "}
          <Link
            href={DEMO_HOME_ROUTE}
            className="cg-interactive font-semibold text-cobalt hover:underline"
          >
            Prøv demoen
          </Link>
        </p>
      </div>
    </div>
  );
}

function StravaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.172" />
    </svg>
  );
}
