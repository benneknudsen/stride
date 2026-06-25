import { StrideLogo } from "@/components/ui/StrideLogo";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <StrideLogo size={28} tone="duo" />
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            Dashboard
          </Button>
          <Button variant="ghost" size="sm">
            Activities
          </Button>
          <Button variant="ghost" size="sm">
            Coach
          </Button>
        </nav>
      </div>
    </header>
  );
}
