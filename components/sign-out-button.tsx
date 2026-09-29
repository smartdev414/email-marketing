"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => signOutAction())}
    >
      <LogOut className="size-4" />
      {pending ? "Signing out…" : "Sign out & reconnect"}
    </Button>
  );
}
