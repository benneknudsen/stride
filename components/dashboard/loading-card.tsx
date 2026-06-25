import { Card, CardContent } from "@/components/ui/card";
import { StrideLoader } from "@/components/ui/StrideLoader";

interface LoadingCardProps {
  label?: string;
  className?: string;
}

export function LoadingCard({
  label = "Analysing your runs…",
  className,
}: LoadingCardProps) {
  return (
    <Card className={className} hover={false}>
      <CardContent className="flex min-h-[200px] items-center justify-center">
        <StrideLoader size={16} motion="wave" label={label} />
      </CardContent>
    </Card>
  );
}
