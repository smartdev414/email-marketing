import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";

import { auth } from "@/auth";
import { GOOGLE_SCOPES, gmailCapabilities } from "@/auth.config";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
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
import { remainingDailyQuota } from "@/lib/suppression";
import { prisma } from "@/lib/prisma";
import { appUrl, trackingUrl } from "@/lib/tracking";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [account, quota, suppressions, suppressionCount, team] = await Promise.all([
    userId
      ? prisma.account.findFirst({
          where: { userId, provider: "google" },
          select: { scope: true, refresh_token: true, expires_at: true },
        })
      : null,
    userId ? remainingDailyQuota(userId) : { limit: DAILY_SEND_LIMIT, sentToday: 0, remaining: 0 },
    prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.suppression.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
  ]);

  const { canSend, canRead } = gmailCapabilities(account?.scope);
  const grantedScopes = (account?.scope ?? "").split(/\s+/).filter(Boolean);
  const needsReconnect = !canSend || !canRead || !account?.refresh_token;

  // What the app needs to be able to do, not which exact scope strings grant it.
  const capabilities = [
    { label: "Send campaign email from your mailbox", ok: canSend },
    { label: "Read your threads to detect replies and bounces", ok: canRead },
    { label: "Keep sending after the access token expires (refresh token)", ok: Boolean(account?.refresh_token) },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your Gmail connection, sending limits and the team roster."
      >
        <SignOutButton />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sent today"
          value={quota.sentToday}
          hint={`Limit ${quota.limit} per mailbox`}
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
          <CardTitle className="text-base">Gmail connection</CardTitle>
          <CardDescription>
            Campaigns send through your own mailbox using these permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {capabilities.map((capability) => (
              <div key={capability.label} className="flex items-start gap-2 text-sm">
                {capability.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
                )}
                <span>{capability.label}</span>
              </div>
            ))}
          </div>

          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer select-none">
              {grantedScopes.length > 0
                ? `${grantedScopes.length} scopes granted`
                : "No scopes recorded yet"}
            </summary>
            <div className="mt-2 space-y-1">
              <p className="font-medium">Granted</p>
              {grantedScopes.length > 0 ? (
                grantedScopes.map((scope) => (
                  <code key={scope} className="block break-all">
                    {scope}
                  </code>
                ))
              ) : (
                <p>&mdash;</p>
              )}
              <p className="pt-2 font-medium">Requested</p>
              {GOOGLE_SCOPES.split(" ").map((scope) => (
                <code key={scope} className="block break-all">
                  {scope}
                </code>
              ))}
            </div>
          </details>

          {needsReconnect ? (
            <div className="border-destructive/30 bg-destructive/10 space-y-2 rounded-md border p-3 text-sm">
              <p className="font-medium">Reconnect needed</p>
              <p className="text-muted-foreground">
                {!account?.refresh_token
                  ? "No refresh token is stored, so sending will stop once the access token expires."
                  : !canSend
                    ? "The grant does not allow sending mail."
                    : "The grant does not allow reading your threads, so replies cannot be detected."}{" "}
                Sign out and sign back in, accepting every Gmail permission.
              </p>
              <SignOutButton />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Everything the platform needs is granted.
            </p>
          )}
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
              at most {DAILY_SEND_LIMIT} emails per day (<code>DAILY_SEND_LIMIT</code>).
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
