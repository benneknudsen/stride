"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await signOut({ callbackUrl: "/login" });
    });
  }

  return (
    <Button variant="destructive" size="sm" onClick={handleClick} disabled={isPending}>
      <LogOut className="size-4" />
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
