"use client";

import { Loader2 } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { RunnerGlyph } from "@/components/cobalt/RunnerGlyph";
import { LoginLink } from "@/components/cobalt/velkommen/LoginLink";
import { DEMO_HOME_ROUTE } from "@/lib/routes";

type OAuthProvider = "strava";

// Issue #304: the measured reference entrance (docs/bevaegelsesstrategi.md a.5)
// grows from zero — opacity + scale together, done in 600–1000 ms on a strong
// ease-out. Dampened for Stride: the card fades + scales 0.96 → 1, and its
// rows stagger in reading order. Transform/opacity only, so the layout box
// never moves (no CLS). Under prefers-reduced-motion every duration is 0 —
// nothing travels, the content just appears.
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export default function LoginPage() {
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

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

  const cardVariants: Variants = {
    hidden: { opacity: 0, scale: 0.96 },
    show: {
      opacity: 1,
      scale: 1,
      transition: reduceMotion
        ? { duration: 0 }
        : { duration: 0.7, ease: EASE, delayChildren: 0.12, staggerChildren: 0.07 },
    },
  };
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE },
    },
  };

  return (
    <div className="w-full max-w-[360px]">
      {/* Cobalt Glass card */}
      <motion.div
        data-testid="login-card"
        variants={cardVariants}
        initial="hidden"
        animate="show"
        className="rounded-card border border-cobalt/10 bg-white/60 p-8 shadow-glass backdrop-blur-xl"
      >
        <motion.div variants={itemVariants}>
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
        </motion.div>
        <motion.p variants={itemVariants} className="mb-6 text-[14px] leading-relaxed text-ink">
          Din løbecoach venter på dig.
        </motion.p>

        <motion.div variants={itemVariants}>
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
        </motion.div>

        {/* The demo is a real secondary CTA, not a footnote — same offer as the
            landing, one line explaining what it is. Strava stays primary. */}
        <motion.div variants={itemVariants} className="mt-3">
          <LoginLink
            href={DEMO_HOME_ROUTE}
            trackEvent="demo_åbnet"
            className="cg-interactive flex w-full items-center justify-center rounded-card border border-cobalt/20 bg-white/70 px-4 py-2.5 text-[14px] font-semibold text-cobalt transition-colors hover:bg-white"
          >
            Udforsk demoen
          </LoginLink>
        </motion.div>
        <motion.p
          variants={itemVariants}
          className="mt-2.5 text-center text-[12.5px] leading-relaxed text-ink"
        >
          Demoen er 30 ture med de rigtige widgets — helt uden login.
        </motion.p>
      </motion.div>
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
