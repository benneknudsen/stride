import { StrideLogo } from "@/components/ui/StrideLogo";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-8 bg-gradient-to-br from-bg to-bg-2 px-6 py-12">
      <StrideLogo size={32} tone="duo" />
      {children}
    </main>
  );
}
