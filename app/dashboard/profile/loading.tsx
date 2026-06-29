import { StrideLoader } from "@/components/ui/StrideLoader";

export default function ProfileLoading() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <StrideLoader size={64} />
    </main>
  );
}
