import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, Eye, MessageSquareReply, Send, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignControls } from "@/components/campaigns/campaign-controls";
import { EditCampaignButton } from "@/components/campaigns/edit-campaign-button";
import { CampaignVariants } from "@/components/campaigns/campaign-variants";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { aiConfigured } from "@/lib/ai-variants";
import { mailboxReady } from "@/lib/mailbox";
import { prisma } from "@/lib/prisma";
import { describeSendWindow } from "@/lib/send-window";
import { getCampaignStats } from "@/lib/stats";
import { mailboxQuotas } from "@/lib/suppression";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      template: true,
      fromUser: { select: { name: true, email: true } },
      senders: { select: { id: true, email: true, isActive: true }, orderBy: { createdAt: "asc" } },
      variants: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!campaign) notFound();

  const [stats, recipients, sentByVariant, repliedByVariant, templates, ownerMailboxes] =
    await Promise.all([
      getCampaignStats(id),
      // Every recipient the email actually went out to, newest first.
      prisma.campaignRecipient.findMany({
        where: { campaignId: id, sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        include: {
          contact: {
            select: { email: true, firstName: true, lastName: true, company: true },
          },
          emailAccount: { select: { email: true } },
        },
      }),
      prisma.campaignRecipient.groupBy({
        by: ["variantId"],
        where: { campaignId: id, sentAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.campaignRecipient.groupBy({
        by: ["variantId"],
        where: { campaignId: id, repliedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.template.findMany({
        where: { isArchived: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // The Edit dialog offers the campaign owner's mailboxes.
      prisma.emailAccount.findMany({
        where: { userId: campaign.fromUserId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          dailyLimit: true,
          provider: true,
          scope: true,
          refreshToken: true,
        },
      }),
    ]);

  const usable = ownerMailboxes.filter(mailboxReady);
  const quotas = await mailboxQuotas(usable);
  const senders = usable.map((mailbox) => ({
    id: mailbox.id,
    email: mailbox.email,
    remaining: quotas.get(mailbox.id)?.remaining ?? 0,
    limit: quotas.get(mailbox.id)?.limit ?? 0,
  }));

  /** Sent and reply counts per version; `null` is the template as written. */
  const versionStats = (variantId: string | null) => ({
    sent: sentByVariant.find((row) => row.variantId === variantId)?._count._all ?? 0,
    replied: repliedByVariant.find((row) => row.variantId === variantId)?._count._all ?? 0,
  });

  const progress = stats.total === 0 ? 0 : Math.round((stats.sent / stats.total) * 100);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/campaigns">
          <ArrowLeft className="size-4" />
          All campaigns
        </Link>
      </Button>

      <PageHeader
        title={campaign.name}
        description={campaign.description ?? campaign.template.subject}
      >
        <EditCampaignButton
          campaign={{
            id: campaign.id,
            name: campaign.name,
            templateId: campaign.templateId,
            templateName: campaign.template.name,
            batchSize: campaign.batchSize,
            trackOpens: campaign.trackOpens,
            trackClicks: campaign.trackClicks,
            senderIds: campaign.senders.map((sender) => sender.id),
          }}
          templates={templates}
          senders={senders}
        />
        <CampaignControls
          campaignId={campaign.id}
          status={campaign.status}
          autoPaused={Boolean(campaign.autoPausedAt)}
          pending={stats.pending}
          batchSize={campaign.batchSize}
        />
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={campaign.status} />
        {campaign.status === "PAUSED" && campaign.autoPausedAt ? (
          <Badge variant="outline" className="font-normal">
            Auto-paused · sends {describeSendWindow()}
          </Badge>
        ) : null}
        <Badge variant="secondary" className="font-normal">
          {campaign.template.name}
        </Badge>
        {campaign.senders.length === 0 ? (
          <Badge variant="destructive" className="font-normal">
            No sending mailbox
          </Badge>
        ) : (
          campaign.senders.map((sender) => (
            <Badge
              key={sender.id}
              variant={sender.isActive ? "secondary" : "outline"}
              className="font-normal"
              title={sender.isActive ? "Sending mailbox" : "Paused on the Integrations page"}
            >
              From {sender.email}
              {sender.isActive ? "" : " (paused)"}
            </Badge>
          ))
        )}
        {campaign.trackOpens ? (
          <Badge variant="outline" className="font-normal">
            Open tracking on
          </Badge>
        ) : null}
        {campaign.trackClicks ? (
          <Badge variant="outline" className="font-normal">
            Click tracking on
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Audience"
          value={stats.total}
          hint={`${stats.pending} still queued`}
          icon={Users}
        />
        <StatCard
          label="Sent"
          value={stats.sent}
          hint={stats.failed > 0 ? `${stats.failed} failed` : "No failures"}
          icon={Send}
        />
        <StatCard
          label="Opened"
          value={`${stats.openRate}%`}
          hint={`${stats.opened} of ${stats.sent}`}
          icon={Eye}
        />
        <StatCard
          label="Replied"
          value={`${stats.replyRate}%`}
          hint={`${stats.replied} of ${stats.sent}`}
          icon={MessageSquareReply}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sending progress</CardTitle>
          <CardDescription>
            {stats.pending === 0
              ? "Every email in this campaign has been released."
              : `${stats.pending} emails left — released ${campaign.batchSize} at a time.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={progress} />
          <p className="text-muted-foreground text-xs tabular-nums">
            {stats.sent} of {stats.total} sent ({progress}%)
          </p>
        </CardContent>
      </Card>

      <CampaignVariants
        campaignId={campaign.id}
        template={{
          subject: campaign.template.subject,
          body: campaign.template.body,
          ...versionStats(null),
        }}
        variants={campaign.variants.map((variant) => ({
          id: variant.id,
          subject: variant.subject,
          body: variant.body,
          isActive: variant.isActive,
          ...versionStats(variant.id),
        }))}
        aiEnabled={aiConfigured()}
        canGenerate={campaign.status !== "COMPLETED"}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sent recipients</CardTitle>
          <CardDescription>
            {recipients.length === 0
              ? "Nothing has gone out yet."
              : `${recipients.length.toLocaleString()} email${recipients.length === 1 ? "" : "s"} sent, newest first.`}
            {stats.pending > 0 ? ` ${stats.pending.toLocaleString()} still queued.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mailbox</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell>
                    <p className="font-medium">
                      {[recipient.contact.firstName, recipient.contact.lastName]
                        .filter(Boolean)
                        .join(" ") || recipient.contact.email}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {recipient.contact.email}
                      {recipient.contact.company ? ` · ${recipient.contact.company}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={recipient.status} />
                    {recipient.error ? (
                      <p className="text-destructive mt-1 max-w-xs truncate text-xs">
                        {recipient.error}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {recipient.emailAccount?.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {recipient.openCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {recipient.clickCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {recipient.sentAt ? (
                      <span title={format(recipient.sentAt, "PPpp")}>
                        {formatDistanceToNow(recipient.sentAt, { addSuffix: true })}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
