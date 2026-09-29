import { formatDistanceToNow } from "date-fns";
import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CreateCampaignDialog } from "@/components/campaigns/create-campaign-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
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
import { prisma } from "@/lib/prisma";
import { rate } from "@/lib/stats";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const [campaigns, templates, tagRows] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true } },
        fromUser: { select: { name: true, email: true } },
        _count: { select: { recipients: true } },
      },
    }),
    prisma.template.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true },
    }),
    prisma.contact.findMany({ select: { tags: true }, take: 2000 }),
  ]);

  const tags = [...new Set(tagRows.flatMap((row) => row.tags))].sort();

  // Per-campaign counters in one grouped query rather than N round-trips.
  // Counting a nullable column counts its non-null rows, which is exactly
  // "how many were sent / opened / replied".
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["campaignId"],
    _count: { _all: true, sentAt: true, firstOpenedAt: true, repliedAt: true },
  });

  const counts = new Map(grouped.map((row) => [row.campaignId, row._count]));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each campaign draws a random audience from your contacts and sends from your Gmail."
      >
        <CreateCampaignDialog templates={templates} tags={tags} />
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
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No campaigns yet"
          description="Create a campaign, review the audience it drew, then release the first batch."
        >
          <CreateCampaignDialog templates={templates} tags={tags} />
        </EmptyState>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => {
                  const bucket = counts.get(campaign.id);
                  const sent = bucket?.sentAt ?? 0;
                  const opened = bucket?.firstOpenedAt ?? 0;
                  const replied = bucket?.repliedAt ?? 0;

                  return (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="font-medium hover:underline"
                        >
                          {campaign.name}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {campaign.template.name} ·{" "}
                          {campaign.fromUser.name ?? campaign.fromUser.email}
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
