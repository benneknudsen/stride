import { cn } from "@/lib/utils";

// "stride" wordmark — Bricolage Grotesque 700, lowercase, tight tracking.
// Colour defaults to cobalt; override via className on dark surfaces.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-cg-display text-[20px] font-bold lowercase tracking-[-0.03em] text-cobalt",
        className
      )}
    >
      stride
    </span>
  );
}
