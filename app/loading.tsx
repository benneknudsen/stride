import { RunnerLoader } from "@/components/cobalt/RunnerLoader";

export default function RootLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-silver">
      <RunnerLoader size={70} label="STRIDE" />
    </main>
  );
}
