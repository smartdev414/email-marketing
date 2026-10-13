import { formatDistanceToNow } from "date-fns";
import { Eye, MailCheck, Megaphone, MessageSquareReply, Send, Trophy, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { DailyChart } from "@/components/dashboard/daily-chart";
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
import { hasMailboxAccess } from "@/lib/mailbox";
import { SEND_TIMEZONE } from "@/lib/send-window";
import {
  getDailyActivity,
  getDashboardStats,
  getPeriodStats,
  getTopCampaigns,
  MIN_SENT_TO_RANK,
  type PeriodStats,
} from "@/lib/stats";
import { cn } from "cn";

export const metadata: Metadata = { title: "Dashboard" };

const CHART_DAYS = 30;

/** Calendar dates as the sending timezone sees them, e.g. "Mon, Oct 12". */
function localDate(date: Date, withWeekday = true) {
  return date.toLocaleDateString("en-US", {
    timeZone: SEND_TIMEZONE,
    month: "short",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
  });
}

function PeriodCard({
  label,
  range,
  stats,
}: {
  label: string;
  range: string;
  stats: PeriodStats;
}) {
  const metrics = [
    { label: "Sent", value: stats.sent.toLocaleString() },
    {
      label: "Failed",
      value: stats.failed.toLocaleString(),
      tone: stats.failed > 0 ? "text-destructive" : undefined,
    },
    { label: "Replied", value: stats.replied.toLocaleString(), hint: `${stats.replyRate}% rate` },
    { label: "Open rate", value: `${stats.openRate}%` },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{range}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="text-muted-foreground text-xs">{metric.label}</p>
            <p className={cn("text-xl font-semibold tabular-nums", metric.tone)}>
              {metric.value}
              {metric.hint ? (
                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                  {metric.hint}
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const [stats, gmailReady, periods, daily, topCampaigns] = await Promise.all([
    getDashboardStats(),
    session?.user?.id ? hasMailboxAccess(session.user.id) : Promise.resolve(false),
    getPeriodStats(),
    getDailyActivity(CHART_DAYS),
    getTopCampaigns(),
  ]);
  const best = topCampaigns[0];

  const rangeOf = (period: (typeof periods)[number]) =>
    period.key === "today" || period.key === "yesterday"
      ? localDate(period.from)
      : `Since ${localDate(period.from, period.key === "week")}`;

  const totals = daily.reduce(
    (sum, row) => ({
      sent: sum.sent + row.sent,
      failed: sum.failed + row.failed,
      opened: sum.opened + row.opened,
      replied: sum.replied + row.replied,
    }),
    { sent: 0, failed: 0, opened: 0, replied: 0 },
  );

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
              <p className="text-sm font-medium">No sending mailbox connected</p>
              <p className="text-muted-foreground text-sm">
                Connect one or more Gmail, Outlook or other email accounts before you send a campaign. Campaigns rotate
                between them to keep each inbox&rsquo;s volume low.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/integrations">Open integrations</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Contacts"
          value={stats.contacts.toLocaleString()}
          hint={`${stats.activeContacts.toLocaleString()} still contactable`}
          icon={Users}
        />
        <StatCard
          label="Campaigns"
          value={stats.campaigns.toLocaleString()}
          hint={`${stats.sendingCampaigns} sending · ${stats.pausedCampaigns} paused`}
          icon={Megaphone}
        />
        <StatCard
          label="Emails sent"
          value={stats.sent.toLocaleString()}
          hint={`${stats.failed.toLocaleString()} failed in total`}
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {periods.map((period) => (
          <PeriodCard
            key={period.key}
            label={period.label}
            range={rangeOf(period)}
            stats={period.stats}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sending, last {CHART_DAYS} days</CardTitle>
            <CardDescription>
              {totals.sent.toLocaleString()} sent · {totals.failed.toLocaleString()} failed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart
              data={daily}
              layout="stacked"
              series={[
                { key: "sent", label: "Sent", color: "var(--viz-sent)" },
                { key: "failed", label: "Failed", color: "var(--viz-failed)" },
              ]}
              summary={`Emails per day over the last ${CHART_DAYS} days: ${totals.sent} sent and ${totals.failed} failed.`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engagement, last {CHART_DAYS} days</CardTitle>
            <CardDescription>
              {totals.opened.toLocaleString()} first opens · {totals.replied.toLocaleString()}{" "}
              replies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart
              data={daily}
              layout="grouped"
              series={[
                { key: "opened", label: "Opened", color: "var(--viz-opened)" },
                { key: "replied", label: "Replied", color: "var(--viz-replied)" },
              ]}
              summary={`Opens and replies per day over the last ${CHART_DAYS} days: ${totals.opened} opens and ${totals.replied} replies.`}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4" />
            Top campaigns
          </CardTitle>
          <CardDescription>
            Ranked by reply rate, then open rate. Campaigns need {MIN_SENT_TO_RANK} sends to be
            ranked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!best ? (
            <p className="text-muted-foreground text-sm">
              No campaign has sent {MIN_SENT_TO_RANK} emails yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Open rate</TableHead>
                  <TableHead className="text-right">Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCampaigns.map((row) => (
                  <TableRow key={row.campaignId}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${row.campaignId}`}
                        className="font-medium hover:underline"
                      >
                        {row.campaign.name}
                      </Link>
                      {row === best ? (
                        <span className="bg-muted text-foreground ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                          Best
                        </span>
                      ) : null}
                      <p className="text-muted-foreground text-xs">{row.campaign.template.name}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.campaign.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.sent.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        row.failed > 0 ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {row.failed.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.openRate}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.replyRate}%
                      <span className="text-muted-foreground ml-1 text-xs">({row.replied})</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={campaign.senders.map((sender) => sender.email).join("\n")}
                    >
                      {campaign.senders.length > 1
                        ? `${campaign.senders.length} mailboxes`
                        : (campaign.senders[0]?.email ?? "No mailbox")}
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
