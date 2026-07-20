import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Liquid-glass widget. `variant` swaps the surface (frosted white / red / cobalt);
// bg, border, blur, shadow and radius all come from the design tokens.
const glassCardVariants = cva("relative rounded-widget", {
  variants: {
    variant: {
      default: "cg-glass text-cobalt",
      red: "cg-glass-red text-onred",
      cobalt: "cg-glass-cobalt text-silver",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface GlassCardProps
  extends React.ComponentPropsWithRef<"div">,
    VariantProps<typeof glassCardVariants> {}

export function GlassCard({ className, variant, children, ...props }: GlassCardProps) {
  return (
    <div className={cn(glassCardVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}

export { glassCardVariants };
