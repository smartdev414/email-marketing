import { formatDistanceToNow } from "date-fns";
import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CampaignRowActions } from "@/components/campaigns/campaign-row-actions";
import {
  CreateCampaignDialog,
  type SenderOption,
} from "@/components/campaigns/create-campaign-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { UrlSelect } from "@/components/url-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/auth";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CampaignStatus } from "@/lib/generated/prisma/enums";
import { mailboxReady } from "@/lib/mailbox";
import { mailboxQuotas } from "@/lib/suppression";
import { prisma } from "@/lib/prisma";
import { rate } from "@/lib/stats";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS_FILTERS: { value: "all" | CampaignStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENDING", label: "Sending" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "recent", label: "Last broadcast" },
  { value: "sent", label: "Most sent" },
  { value: "opens", label: "Best open rate" },
  { value: "replies", label: "Most replies" },
];

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const session = await auth();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const status =
    STATUS_FILTERS.find((filter) => filter.value === params.status)?.value ?? "all";
  const mailbox = typeof params.mailbox === "string" ? params.mailbox : "all";
  const sort = SORTS.find((option) => option.value === params.sort)?.value ?? "newest";
  const filtered = Boolean(query) || status !== "all" || mailbox !== "all";

  const where: Prisma.CampaignWhereInput = {
    ...(status !== "all" ? { status } : {}),
    ...(mailbox !== "all" ? { senders: { some: { id: mailbox } } } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { template: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [campaigns, templates, mailboxes, campaignMailboxes] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
      include: {
        template: { select: { name: true } },
        senders: { select: { id: true, email: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { recipients: true } },
      },
    }),
    prisma.template.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true },
    }),
    // Every user's active mailboxes: the create dialog offers the current
    // user's, and each campaign's Edit dialog offers its owner's.
    prisma.emailAccount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        email: true,
        dailyLimit: true,
        provider: true,
        scope: true,
        refreshToken: true,
      },
    }),
    // Every mailbox some campaign sends from, for the mailbox filter.
    prisma.emailAccount.findMany({
      where: { campaigns: { some: {} } },
      orderBy: { email: "asc" },
      select: { id: true, email: true },
    }),
  ]);

  const usable = mailboxes.filter(mailboxReady);
  const quotas = await mailboxQuotas(usable);
  const sendersByOwner = new Map<string, SenderOption[]>();
  for (const mailbox of usable) {
    const option = {
      id: mailbox.id,
      email: mailbox.email,
      remaining: quotas.get(mailbox.id)?.remaining ?? 0,
      limit: quotas.get(mailbox.id)?.limit ?? 0,
    };
    sendersByOwner.set(mailbox.userId, [...(sendersByOwner.get(mailbox.userId) ?? []), option]);
  }
  const senders = sendersByOwner.get(session?.user?.id ?? "") ?? [];

  // Per-campaign counters in one grouped query rather than N round-trips.
  // Counting a nullable column counts its non-null rows, which is exactly
  // "how many were sent / opened / replied". The latest sentAt is the
  // campaign's last broadcast.
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["campaignId"],
    _count: { _all: true, sentAt: true, firstOpenedAt: true, repliedAt: true },
    _max: { sentAt: true },
  });

  const counts = new Map(grouped.map((row) => [row.campaignId, row._count]));
  const lastSent = new Map(grouped.map((row) => [row.campaignId, row._max.sentAt]));

  // Result-based sorts need the counters above, so they happen here.
  const stat = (id: string) => {
    const bucket = counts.get(id);
    const sent = bucket?.sentAt ?? 0;
    return {
      sent,
      openRate: sent ? (bucket?.firstOpenedAt ?? 0) / sent : 0,
      replies: bucket?.repliedAt ?? 0,
    };
  };
  if (sort === "sent") campaigns.sort((a, b) => stat(b.id).sent - stat(a.id).sent);
  if (sort === "opens") campaigns.sort((a, b) => stat(b.id).openRate - stat(a.id).openRate);
  if (sort === "replies") campaigns.sort((a, b) => stat(b.id).replies - stat(a.id).replies);
  if (sort === "recent")
    campaigns.sort(
      (a, b) => (lastSent.get(b.id)?.getTime() ?? 0) - (lastSent.get(a.id)?.getTime() ?? 0),
    );

  function statusHref(value: string) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (value !== "all") search.set("status", value);
    if (mailbox !== "all") search.set("mailbox", mailbox);
    if (sort !== "newest") search.set("sort", sort);
    return search.size ? `/campaigns?${search.toString()}` : "/campaigns";
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each campaign draws a random audience from your contacts and rotates sending across the mailboxes you pick."
      >
        <CreateCampaignDialog templates={templates} senders={senders} />
      </PageHeader>

      {templates.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Write a template first"
          description="A campaign needs an email to send. Create a template, then come back."
        >
          <Button asChild size="sm">
            <Link href="/templates">Go to templates</Link>
          </Button>
        </EmptyState>
      ) : campaigns.length === 0 && !filtered ? (
        <EmptyState
          icon={Send}
          title="No campaigns yet"
          description="Create a campaign, review the audience it drew, then release the first batch."
        >
          <CreateCampaignDialog templates={templates} senders={senders} />
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput placeholder="Search campaign or template…" />
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  asChild
                  size="sm"
                  variant={status === filter.value ? "secondary" : "ghost"}
                >
                  <Link href={statusHref(filter.value)}>{filter.label}</Link>
                </Button>
              ))}
            </div>
            <UrlSelect
              param="mailbox"
              label="Filter by mailbox"
              defaultValue="all"
              searchable
              searchPlaceholder="Search mailboxes…"
              options={[
                { value: "all", label: "All mailboxes" },
                ...campaignMailboxes.map((box) => ({ value: box.id, label: box.email })),
              ]}
            />
            <UrlSelect param="sort" label="Sort campaigns" defaultValue="newest" options={SORTS} />
            <p className="text-muted-foreground ml-auto text-sm tabular-nums">
              {campaigns.length.toLocaleString()} campaign{campaigns.length === 1 ? "" : "s"}
            </p>
          </div>

          {campaigns.length === 0 ? (
            <EmptyState
              icon={Send}
              title="No matching campaigns"
              description="Try a different search, status or mailbox."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Audience</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Opens</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last broadcast</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => {
                      const bucket = counts.get(campaign.id);
                      const sent = bucket?.sentAt ?? 0;
                      const opened = bucket?.firstOpenedAt ?? 0;
                      const replied = bucket?.repliedAt ?? 0;
                      const lastBroadcast = lastSent.get(campaign.id);

                      return (
                        // The name link stretches over the whole row, so any
                        // click opens the campaign; the actions menu sits above it.
                        <TableRow key={campaign.id} className="relative cursor-pointer">
                          <TableCell>
                            <Link
                              href={`/campaigns/${campaign.id}`}
                              className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none"
                            >
                              {campaign.name}
                            </Link>
                            <p className="text-muted-foreground text-xs">
                              {campaign.template.name} ·{" "}
                              {campaign.senders.length > 1
                                ? `${campaign.senders.length} mailboxes`
                                : (campaign.senders[0]?.email ?? "No mailbox")}
                            </p>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={campaign.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {campaign._count.recipients}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{sent}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {opened}
                            <span className="text-muted-foreground ml-1 text-xs">
                              {rate(opened, sent)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {replied}
                            <span className="text-muted-foreground ml-1 text-xs">
                              {rate(replied, sent)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDistanceToNow(campaign.createdAt, { addSuffix: true })}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {lastBroadcast
                              ? formatDistanceToNow(lastBroadcast, { addSuffix: true })
                              : "Never"}
                          </TableCell>
                          <TableCell className="relative z-10 text-right">
                            <CampaignRowActions
                              campaign={{
                                id: campaign.id,
                                status: campaign.status,
                                name: campaign.name,
                                templateId: campaign.templateId,
                                templateName: campaign.template.name,
                                batchSize: campaign.batchSize,
                                trackOpens: campaign.trackOpens,
                                trackClicks: campaign.trackClicks,
                                senderIds: campaign.senders.map((sender) => sender.id),
                              }}
                              templates={templates}
                              senders={sendersByOwner.get(campaign.fromUserId) ?? []}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
