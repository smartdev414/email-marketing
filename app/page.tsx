import { Inbox, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PublicShell } from "@/components/legal-page";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

const FEATURES = [
  {
    icon: Mail,
    title: "Send from your own Gmail",
    body: "Campaigns go out from your connected mailbox, so recipients see a real person and replies land in your inbox.",
  },
  {
    icon: Inbox,
    title: "Replies in one place",
    body: "Replies and bounces are picked up automatically, and follow-ups stop as soon as someone answers.",
  },
  {
    icon: ShieldCheck,
    title: "Built-in guardrails",
    body: "Daily sending caps, human pacing, one-click unsubscribe and a permanent suppression list on every campaign.",
  },
];

/** Public home page — also the "Application home page" on the Google consent screen. */
export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <PublicShell>
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Email outreach for your sales team
        </h1>
        <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-lg">
          {site.name} lets your team send personalised campaigns from their own Gmail accounts,
          track replies and manage follow-ups — without landing in spam.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/privacy">How we use your data</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-4xl gap-6 px-6 pb-20 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-lg border p-5">
            <Icon className="text-primary size-5" />
            <h2 className="mt-3 font-medium">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{body}</p>
          </div>
        ))}
      </section>
    </PublicShell>
  );
}
