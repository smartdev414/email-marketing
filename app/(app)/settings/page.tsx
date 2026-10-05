import { Mail, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/settings/password-form";
import { SignOutButton } from "@/components/sign-out-button";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DAILY_SEND_LIMIT, MAX_SEND_GAP_MS, MIN_SEND_GAP_MS } from "@/lib/deliverability";
import { mailboxReady } from "@/lib/mailbox";
import { mailboxQuotas } from "@/lib/suppression";
import { prisma } from "@/lib/prisma";
import { appUrl, trackingUrl } from "@/lib/tracking";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [mailboxes, suppressions, suppressionCount, team, account] = await Promise.all([
    prisma.emailAccount.findMany({
      where: { userId: userId ?? "" },
      select: {
        id: true,
        dailyLimit: true,
        isActive: true,
        provider: true,
        scope: true,
        refreshToken: true,
      },
    }),
    prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.suppression.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.user.findUnique({ where: { id: userId ?? "" }, select: { passwordHash: true } }),
  ]);
  const hasPassword = Boolean(account?.passwordHash);

  const sending = mailboxes.filter((mailbox) => mailbox.isActive && mailboxReady(mailbox));
  const quotas = await mailboxQuotas(mailboxes);
  const quota = { sentToday: 0, remaining: 0 };
  for (const mailbox of mailboxes) {
    const usage = quotas.get(mailbox.id);
    quota.sentToday += usage?.sentToday ?? 0;
    if (sending.includes(mailbox)) quota.remaining += usage?.remaining ?? 0;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Sending limits, spam guardrails and the team roster."
      >
        <SignOutButton />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sent today"
          value={quota.sentToday}
          hint={`Across ${mailboxes.length} mailbox${mailboxes.length === 1 ? "" : "es"}`}
        />
        <StatCard label="Remaining today" value={quota.remaining} hint="Resets at midnight" />
        <StatCard
          label="Suppressed"
          value={suppressionCount}
          hint="Never contacted again"
          icon={ShieldAlert}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sending mailboxes</CardTitle>
          <CardDescription>
            {sending.length === 0
              ? "No mailbox is ready to send. Connect a Gmail or Outlook account on the Integrations page."
              : `${sending.length} mailbox${sending.length === 1 ? " is" : "es are"} ready to send. Campaigns rotate between the ones you pick.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/integrations">
              <Mail className="size-4" />
              Manage mailboxes
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>
            {hasPassword
              ? "You can sign in with your email and this password, as well as with Google."
              : "Set a password to sign in with your email as well as with Google."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm hasPassword={hasPassword} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Spam prevention</CardTitle>
          <CardDescription>
            Guardrails applied automatically to every campaign and automation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="text-muted-foreground list-disc space-y-1.5 pl-5">
            <li>
              <span className="text-foreground font-medium">Daily cap.</span> Each mailbox sends
              at most {DAILY_SEND_LIMIT} emails per day (<code>DAILY_SEND_LIMIT</code>), adjustable
              per mailbox. Campaigns rotate across several mailboxes to spread the volume.
            </li>
            <li>
              <span className="text-foreground font-medium">Human pacing.</span>{" "}
              {Math.round(MIN_SEND_GAP_MS / 1000)}–{Math.round(MAX_SEND_GAP_MS / 1000)} seconds
              between sends, randomised.
            </li>
            <li>
              <span className="text-foreground font-medium">Address screening.</span> Role
              mailboxes (info@, support@…), disposable domains and malformed addresses are
              rejected on import and again at send time.
            </li>
            <li>
              <span className="text-foreground font-medium">Suppression list.</span> Unsubscribes
              and hard bounces are blocked permanently — a later CSV import cannot revive them.
            </li>
            <li>
              <span className="text-foreground font-medium">One-click unsubscribe.</span> Every
              email carries RFC 8058 <code>List-Unsubscribe</code> headers plus a footer link.
            </li>
            <li>
              <span className="text-foreground font-medium">No double-contact.</span> A contact
              can appear in a campaign once, and campaigns can exclude anyone already emailed.
            </li>
            <li>
              <span className="text-foreground font-medium">Content linting.</span> The template
              editor flags spam-trigger wording, shouty subjects and heavy link use.
            </li>
            <li>
              <span className="text-foreground font-medium">Tracking off by default.</span> Open
              pixels hurt cold-email deliverability, so new campaigns start with them disabled.
            </li>
          </ul>

          <div className="bg-muted/40 rounded-md border p-3">
            <p className="font-medium">Still to do outside the app</p>
            <p className="text-muted-foreground mt-1">
              Set SPF, DKIM and DMARC on your sending domain, warm the mailbox up over 2–3 weeks,
              and point <code>NEXT_PUBLIC_TRACKING_URL</code> at a dedicated subdomain such as{" "}
              <code>t.yourdomain.com</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Suppression list</CardTitle>
          <CardDescription>
            {suppressionCount === 0
              ? "Nothing suppressed yet."
              : `${suppressionCount} blocked — showing the ${Math.min(suppressions.length, 20)} most recent.`}
          </CardDescription>
        </CardHeader>
        {suppressions.length > 0 ? (
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressions.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.value}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {entry.type.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {entry.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        ) : null}
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>
            Anyone who signs in with an allowed Google account appears here. The first person to
            sign in becomes the admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <p className="font-medium">{member.name ?? "—"}</p>
                    <p className="text-muted-foreground text-xs">{member.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === "ADMIN" ? "default" : "secondary"}>
                      {member.role.toLowerCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">URLs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">App:</span>{" "}
            <code className="text-xs">{appUrl()}</code>
          </p>
          <p>
            <span className="text-muted-foreground">Tracking:</span>{" "}
            <code className="text-xs">{trackingUrl()}</code>
          </p>
          <p className="text-muted-foreground pt-1 text-xs">
            Tracking URLs must be reachable from the recipient&rsquo;s email client, so opens and
            clicks will not register while this points at localhost.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
