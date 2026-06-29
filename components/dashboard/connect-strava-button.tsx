"use client";

import { useTransition } from "react";
import { connectStrava } from "@/actions/strava";
import { StravaIcon } from "@/components/dashboard/provider-icons";
import { Button } from "@/components/ui/button";

export function ConnectStravaButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const { url } = await connectStrava();
      window.location.href = url;
    });
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={isPending}>
      <StravaIcon className="size-4" mono />
      {isPending ? "Connecting…" : "Connect Strava"}
    </Button>
  );
}
