import { BackgroundBlobs } from "@/components/cobalt/BackgroundBlobs";
import { StrideLogo } from "@/components/ui/StrideLogo";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-silver font-cg-sans">
      <BackgroundBlobs />
      <div className="relative z-10 flex flex-col items-center gap-8 px-6">
        <StrideLogo size={36} tone="duo" />
        {children}
      </div>
    </div>
  );
}
