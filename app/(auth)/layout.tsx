import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-silver font-cg-sans">
      <BackgroundBlobs />
      <div className="relative z-10 flex flex-col items-center gap-8 px-6">
        {/* Simple Cobalt logo — three bars + STRIDE */}
        <div className="flex items-center gap-3">
          <svg width="28" height="24" viewBox="0 0 96 84" fill="none" aria-hidden="true">
            <g transform="translate(13,0) skewX(-13)">
              <rect x="8" y="44" width="16" height="26" rx="7" fill="#1b29c0" opacity="0.55" />
              <rect x="33" y="30" width="16" height="40" rx="7" fill="#1b29c0" opacity="0.8" />
              <rect x="58" y="14" width="16" height="56" rx="7" fill="#C6F432" />
            </g>
          </svg>
          <span
            className="text-[17px] font-semibold tracking-tight text-cobalt"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Stride
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
