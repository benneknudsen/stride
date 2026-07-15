import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-silver font-cg-sans">
      <BackgroundBlobs />
      {/* Branding lives on the login card itself (RunnerGlyph) — no logo here,
          so the auth pages show exactly one Stride mark. */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6">{children}</div>
    </div>
  );
}
