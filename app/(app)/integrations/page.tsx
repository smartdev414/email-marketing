import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Mail, Plus, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { MailboxActions, MailboxActiveSwitch } from "@/components/integrations/mailbox-actions";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UrlSelect } from "@/components/url-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DAILY_SEND_LIMIT } from "@/lib/deliverability";
import { integrationRedirectUri, mailboxReady } from "@/lib/google";
import { mailboxQuotas } from "@/lib/suppression";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Integrations" };

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "paused", label: "Paused" },
  { value: "attention", label: "Needs attention" },
];

const SORTS = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "email", label: "Email A–Z" },
  { value: "sent", label: "Most sent today" },
  { value: "remaining", label: "Most left today" },
  { value: "campaigns", label: "Most campaigns" },
];

type MailboxStatus = "ready" | "paused" | "reconnect" | "disconnected";

function ConnectButton({ size }: { size?: "sm" }) {
  // A plain link: the route redirects off-site to Google's consent screen.
  return (
    <Button asChild size={size}>
      <a href="/api/integrations/google/connect">
        <Plus className="size-4" />
        Connect Gmail account
      </a>
    </Button>
  );
}

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const session = await auth();
  const userId = session?.user?.id ?? "";
  const params = await searchParams;
  const { connected, error } = params;
  const rawQuery = typeof params.q === "string" ? params.q.trim() : "";
  const query = rawQuery.toLowerCase();
  const statusFilter =
    STATUS_FILTERS.find((filter) => filter.value === params.status)?.value ?? "all";
  const sort = SORTS.find((option) => option.value === params.sort)?.value ?? "oldest";

  const mailboxes = await prisma.emailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      fromName: true,
      dailyLimit: true,
      isActive: true,
      scope: true,
      accessToken: true,
      refreshToken: true,
      lastError: true,
      createdAt: true,
      _count: { select: { campaigns: true, recipients: true } },
    },
  });

  const quotas = await mailboxQuotas(mailboxes);

  const sendable = mailboxes.filter((mailbox) => mailbox.isActive && mailboxReady(mailbox));
  const capacity = sendable.reduce(
    (total, mailbox) => total + (quotas.get(mailbox.id)?.remaining ?? 0),
    0,
  );
  const sentToday = mailboxes.reduce(
    (total, mailbox) => total + (quotas.get(mailbox.id)?.sentToday ?? 0),
    0,
  );

  // Same order of checks as the Status badge below.
  function statusOf(mailbox: (typeof mailboxes)[number]): MailboxStatus {
    if (!mailbox.accessToken) return "disconnected";
    if (!mailboxReady(mailbox) || mailbox.lastError) return "reconnect";
    return mailbox.isActive ? "ready" : "paused";
  }

  // Search, filter and sort run here: status is derived, not a column.
  const visible = mailboxes.filter((mailbox) => {
    if (
      query &&
      !mailbox.email.toLowerCase().includes(query) &&
      !mailbox.fromName?.toLowerCase().includes(query)
    ) {
      return false;
    }
    const status = statusOf(mailbox);
    if (statusFilter === "attention") return status === "reconnect" || status === "disconnected";
    return statusFilter === "all" || status === statusFilter;
  });

  const sentOf = (id: string) => quotas.get(id)?.sentToday ?? 0;
  const leftOf = (id: string) => quotas.get(id)?.remaining ?? 0;
  if (sort === "newest") visible.reverse();
  if (sort === "email") visible.sort((a, b) => a.email.localeCompare(b.email));
  if (sort === "sent") visible.sort((a, b) => sentOf(b.id) - sentOf(a.id));
  if (sort === "remaining") visible.sort((a, b) => leftOf(b.id) - leftOf(a.id));
  if (sort === "campaigns") visible.sort((a, b) => b._count.campaigns - a._count.campaigns);

  function statusHref(value: string) {
    const search = new URLSearchParams();
    if (rawQuery) search.set("q", rawQuery);
    if (value !== "all") search.set("status", value);
    if (sort !== "oldest") search.set("sort", sort);
    return search.size ? `/integrations?${search.toString()}` : "/integrations";
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect the Gmail mailboxes your campaigns send from. Campaigns rotate between the mailboxes you pick, so no single inbox sends enough to look like spam."
      >
        <ConnectButton />
      </PageHeader>

      {typeof connected === "string" ? (
        <div className="mb-6 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            <span className="font-medium">{connected}</span> is connected and ready to send.
          </span>
        </div>
      ) : null}

      {typeof error === "string" ? (
        <div className="border-destructive/30 bg-destructive/10 mb-6 flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sending mailboxes"
          value={sendable.length}
          hint={`${mailboxes.length} connected in total`}
          icon={Mail}
        />
        <StatCard label="Sent today" value={sentToday} hint="Across all your mailboxes" icon={Send} />
        <StatCard
          label="Capacity left today"
          value={capacity}
          hint="Sum of each mailbox's remaining limit"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Gmail mailboxes</CardTitle>
          <CardDescription>
            Pause a mailbox to take it out of every campaign&rsquo;s rotation without losing its
            conversations.
          </CardDescription>
        </CardHeader>
        {mailboxes.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Mail}
              title="No mailboxes connected"
              description="Connect at least one Gmail or Google Workspace account before you create a campaign. Several mailboxes on different domains spread the volume best."
            >
              <ConnectButton size="sm" />
            </EmptyState>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) pb-4">
              <SearchInput placeholder="Search Gmail or name…" />
              <div className="flex flex-wrap gap-1">
                {STATUS_FILTERS.map((filter) => (
                  <Button
                    key={filter.value}
                    asChild
                    size="sm"
                    variant={statusFilter === filter.value ? "secondary" : "ghost"}
                  >
                    <Link href={statusHref(filter.value)}>{filter.label}</Link>
                  </Button>
                ))}
              </div>
              <UrlSelect param="sort" label="Sort mailboxes" defaultValue="oldest" options={SORTS} />
              <p className="text-muted-foreground ml-auto text-sm tabular-nums">
                {visible.length === mailboxes.length
                  ? `${mailboxes.length} mailbox${mailboxes.length === 1 ? "" : "es"}`
                  : `${visible.length} of ${mailboxes.length} mailboxes`}
              </p>
            </div>

            {visible.length === 0 ? (
              <div className="px-(--card-spacing) pb-6">
                <EmptyState
                  icon={Mail}
                  title="No matching mailboxes"
                  description="Try a different search or status."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mailbox</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Today</TableHead>
                    <TableHead className="text-right">Campaigns</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((mailbox) => {
                    const quota = quotas.get(mailbox.id);
                    const hasTokens = Boolean(mailbox.accessToken);
                    const ready = hasTokens && mailboxReady(mailbox);
                    // Only these fields cross into client components — never the tokens.
                    const safe = {
                      id: mailbox.id,
                      email: mailbox.email,
                      fromName: mailbox.fromName,
                      dailyLimit: mailbox.dailyLimit,
                      isActive: mailbox.isActive,
                      connected: hasTokens,
                    };

                    return (
                      <TableRow key={mailbox.id}>
                        <TableCell>
                          <p className="font-medium">{mailbox.email}</p>
                          <p className="text-muted-foreground text-xs">
                            {mailbox.fromName ? `Sends as ${mailbox.fromName} · ` : ""}
                            added {formatDistanceToNow(mailbox.createdAt, { addSuffix: true })}
                          </p>
                        </TableCell>
                        <TableCell>
                          {!hasTokens ? (
                            <Badge variant="outline">Disconnected</Badge>
                          ) : !ready || mailbox.lastError ? (
                            <Badge variant="destructive">Reconnect needed</Badge>
                          ) : !mailbox.isActive ? (
                            <Badge variant="secondary">Paused</Badge>
                          ) : (
                            <Badge>Ready</Badge>
                          )}
                          {mailbox.lastError ? (
                            <p className="text-destructive mt-1 max-w-xs truncate text-xs">
                              {mailbox.lastError}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {quota?.sentToday ?? 0}
                          <span className="text-muted-foreground"> / {quota?.limit ?? DAILY_SEND_LIMIT}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {mailbox._count.campaigns}
                        </TableCell>
                        <TableCell>
                          {hasTokens ? <MailboxActiveSwitch mailbox={safe} /> : null}
                        </TableCell>
                        <TableCell>
                          <MailboxActions
                            mailbox={safe}
                            defaultLimit={DAILY_SEND_LIMIT}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">How rotation works</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-3 text-sm">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Each campaign sends from the mailboxes you tick when creating it, taking turns email
              by email.
            </li>
            <li>
              Every mailbox has its own daily limit ({DAILY_SEND_LIMIT} by default). When one runs
              out, the others keep going; when all are out, sending resumes tomorrow.
            </li>
            <li>
              Replies, follow-ups and bounce checks always use the mailbox that sent the original
              email, so conversations stay in one thread.
            </li>
          </ul>
          <div className="bg-muted/40 rounded-md border p-3">
            <p className="text-foreground font-medium">Google Cloud setup</p>
            <p className="mt-1">
              Add this redirect URI to your OAuth client, and while the consent screen is in
              testing, add every mailbox you connect as a test user:
            </p>
            <code className="mt-2 block break-all text-xs">{integrationRedirectUri()}</code>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
