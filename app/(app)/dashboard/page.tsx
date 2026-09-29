import { formatDistanceToNow } from "date-fns";
import { Eye, MailCheck, MessageSquareReply, Send, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
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
import { hasGmailAccess } from "@/lib/google";
import { getDashboardStats } from "@/lib/stats";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  const [stats, gmailReady] = await Promise.all([
    getDashboardStats(),
    session?.user?.id ? hasGmailAccess(session.user.id) : Promise.resolve(false),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back${session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}`}
        description="How your outreach is performing across every campaign."
      >
        <Button asChild>
          <Link href="/campaigns">New campaign</Link>
        </Button>
      </PageHeader>

      {!gmailReady ? (
        <Card className="border-amber-500/30 bg-amber-500/5 mb-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Gmail is not connected yet</p>
              <p className="text-muted-foreground text-sm">
                Sign out and sign back in with Google, accepting the Gmail permissions, before
                you send a campaign.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/settings">Open settings</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contacts"
          value={stats.contacts.toLocaleString()}
          hint={`${stats.activeContacts.toLocaleString()} still contactable`}
          icon={Users}
        />
        <StatCard
          label="Emails sent"
          value={stats.sent.toLocaleString()}
          hint={`${stats.campaigns} campaign${stats.campaigns === 1 ? "" : "s"}`}
          icon={Send}
        />
        <StatCard
          label="Open rate"
          value={`${stats.openRate}%`}
          hint={`${stats.opened.toLocaleString()} opened`}
          icon={Eye}
        />
        <StatCard
          label="Reply rate"
          value={`${stats.replyRate}%`}
          hint={`${stats.replied.toLocaleString()} replied`}
          icon={MessageSquareReply}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent campaigns</CardTitle>
          <CardDescription>The last five campaigns your team created.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentCampaigns.length === 0 ? (
            <EmptyState
              icon={MailCheck}
              title="No campaigns yet"
              description="Import contacts, write a template, then create your first campaign."
            >
              <Button asChild size="sm">
                <Link href="/contacts">Import contacts</Link>
              </Button>
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Audience</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recentCampaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="font-medium hover:underline"
                      >
                        {campaign.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">{campaign.template.name}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign._count.recipients}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {campaign.fromUser.name ?? campaign.fromUser.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDistanceToNow(campaign.createdAt, { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
