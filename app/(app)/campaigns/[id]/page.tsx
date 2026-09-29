import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, Eye, MessageSquareReply, Send, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignControls } from "@/components/campaigns/campaign-controls";
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
import { prisma } from "@/lib/prisma";
import { getCampaignStats } from "@/lib/stats";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      template: true,
      fromUser: { select: { name: true, email: true } },
      senders: { select: { id: true, email: true, isActive: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!campaign) notFound();

  const [stats, recipients] = await Promise.all([
    getCampaignStats(id),
    prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      orderBy: [{ sentAt: "desc" }, { createdAt: "asc" }],
      take: 100,
      include: {
        contact: {
          select: { email: true, firstName: true, lastName: true, company: true },
        },
        emailAccount: { select: { email: true } },
      },
    }),
  ]);

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
        <CampaignControls
          campaignId={campaign.id}
          status={campaign.status}
          pending={stats.pending}
          batchSize={campaign.batchSize}
        />
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={campaign.status} />
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recipients</CardTitle>
          <CardDescription>
            Showing the {Math.min(recipients.length, 100)} most recent.
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
                    ) : (
                      "queued"
                    )}
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
