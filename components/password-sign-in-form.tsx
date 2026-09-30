"use client";

import { useActionState } from "react";

import { signInWithPassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordSignInForm() {
  const [state, action, pending] = useActionState(signInWithPassword, null);

  return (
    <form action={action} className="space-y-3">
      {state?.error ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" variant="outline" className="w-full" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in with email"}
      </Button>
    </form>
  );
}
