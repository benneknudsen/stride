import { AuthBackdrop } from "@/components/cobalt/AuthBackdrop";
import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The auth surface is a single screen: lock it to the dynamic viewport so
    // the mobile URL bar changing height can never expose a scrollable strip.
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden overscroll-none bg-silver font-cg-sans supports-[height:100dvh]:h-[100dvh]">
      {/* #304: the login card and its rows are server-rendered in Motion's
          `hidden` state (opacity 0 / translateY(8px)) as inline styles, so
          with scripts disabled the page would show an empty card. `!important`
          is required to win over those inline styles. The `(scripting: none)`
          rule in globals.css covers engines that know the media feature; this
          <noscript> style covers older ones. */}
      <noscript>
        <style>{`[data-testid="login-card"],[data-testid="login-card"] *{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <BackgroundBlobs />
      <AuthBackdrop />
      {/* Branding lives on the login card itself (RunnerGlyph) — no logo here,
          so the auth pages show exactly one Stride mark. */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6">{children}</div>
    </div>
  );
}
