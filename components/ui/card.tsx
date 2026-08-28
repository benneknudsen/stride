import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover = true, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-border bg-card p-6 shadow-float",
        hover && "transition-colors duration-150 hover:bg-card-2",
        className
      )}
      {...props}
    />
  );
}
