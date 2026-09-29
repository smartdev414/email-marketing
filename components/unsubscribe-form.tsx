"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { unsubscribeByToken } from "@/lib/actions/contacts";
import { Button } from "@/components/ui/button";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<{ done: boolean; email?: string; error?: string }>({
    done: false,
  });
  const [pending, startTransition] = useTransition();

  if (state.done) {
    return (
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">You are unsubscribed</p>
          <p className="text-muted-foreground">
            {state.email} will not receive any further emails from us.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state.error ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await unsubscribeByToken(token);
            if (result.ok) setState({ done: true, email: result.email });
            else setState({ done: false, error: result.error });
          })
        }
      >
        {pending ? "Unsubscribing…" : "Unsubscribe me"}
      </Button>
    </div>
  );
}
