import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { auth } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That Google account is not on the team allowlist.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  Configuration: "Google sign-in is not configured correctly. Check the server env vars.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await searchParams;
  const message = typeof error === "string" ? ERROR_MESSAGES[error] ?? "Sign-in failed. Try again." : null;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <MailCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Outreach</h1>
            <p className="text-muted-foreground text-sm">Email marketing for the sales team</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use your work Google account. Campaigns go out from your own mailbox, so replies
              land in your inbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? (
              <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
                {message}
              </p>
            ) : null}
            <GoogleSignInButton />
            <p className="text-muted-foreground text-xs leading-relaxed">
              We ask for permission to send email and read your threads so the platform can
              detect replies. Nothing is sent without you starting a campaign.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
