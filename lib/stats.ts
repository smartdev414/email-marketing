import { Prisma, type CampaignStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  daysBefore,
  SEND_TIMEZONE,
  startOfSendDay,
  startOfSendMonth,
  startOfSendWeek,
} from "@/lib/send-window";

export function rate(part: number, whole: number) {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export async function getDashboardStats() {
  const [contacts, activeContacts, campaignStatuses, sent, opened, replied, failed, recentCampaigns] =
    await Promise.all([
      prisma.contact.count(),
      prisma.contact.count({ where: { status: "ACTIVE" } }),
      prisma.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.campaignRecipient.count({ where: { sentAt: { not: null } } }),
      prisma.campaignRecipient.count({ where: { firstOpenedAt: { not: null } } }),
      prisma.campaignRecipient.count({ where: { repliedAt: { not: null } } }),
      prisma.campaignRecipient.count({ where: { status: "FAILED" } }),
      prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          template: { select: { name: true } },
          senders: { select: { email: true }, orderBy: { createdAt: "asc" } },
          _count: { select: { recipients: true } },
        },
      }),
    ]);

  const campaignsIn = (status: CampaignStatus) =>
    campaignStatuses.find((row) => row.status === status)?._count._all ?? 0;

  return {
    contacts,
    activeContacts,
    campaigns: campaignStatuses.reduce((total, row) => total + row._count._all, 0),
    sendingCampaigns: campaignsIn("SENDING"),
    pausedCampaigns: campaignsIn("PAUSED"),
    sent,
    opened,
    replied,
    failed,
    openRate: rate(opened, sent),
    replyRate: rate(replied, sent),
    recentCampaigns,
  };
}

/** A JS instant as the UTC wall-clock timestamp Prisma stores in `TIMESTAMP(3)` columns. */
function utc(date: Date) {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

export type PeriodStats = {
  sent: number;
  failed: number;
  /** Replies that arrived in the period, whenever the email went out. */
  replied: number;
  /** Of the emails sent in the period, the share opened / replied to so far. */
  openRate: number;
  replyRate: number;
};

/**
 * Activity between `from` and `to` (open-ended when `to` is missing). Failures
 * have no timestamp of their own, so the time a recipient was marked failed
 * (`updatedAt`) stands in for it.
 */
async function periodStats(from: Date, to?: Date): Promise<PeriodStats> {
  const within = (column: string) => {
    const field = Prisma.raw(`"${column}"`);
    return to
      ? Prisma.sql`${field} >= ${utc(from)} AND ${field} < ${utc(to)}`
      : Prisma.sql`${field} >= ${utc(from)}`;
  };

  const [row] = await prisma.$queryRaw<
    { sent: number; opened: number; answered: number; replied: number; failed: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE ${within("sentAt")})::int AS sent,
      count(*) FILTER (WHERE ${within("sentAt")} AND "firstOpenedAt" IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE ${within("sentAt")} AND "repliedAt" IS NOT NULL)::int AS answered,
      count(*) FILTER (WHERE ${within("repliedAt")})::int AS replied,
      count(*) FILTER (WHERE "status" = 'FAILED' AND ${within("updatedAt")})::int AS failed
    FROM "CampaignRecipient"
  `;

  return {
    sent: row.sent,
    failed: row.failed,
    replied: row.replied,
    openRate: rate(row.opened, row.sent),
    replyRate: rate(row.answered, row.sent),
  };
}

/** Today, yesterday, this week and this month, in the sending timezone. */
export async function getPeriodStats(now = new Date()) {
  const today = startOfSendDay(now);
  const yesterday = daysBefore(today, 1);
  const week = startOfSendWeek(now);
  const month = startOfSendMonth(now);

  const [todayStats, yesterdayStats, weekStats, monthStats] = await Promise.all([
    periodStats(today),
    periodStats(yesterday, today),
    periodStats(week),
    periodStats(month),
  ]);

  return [
    { key: "today", label: "Today", from: today, stats: todayStats },
    { key: "yesterday", label: "Yesterday", from: yesterday, to: today, stats: yesterdayStats },
    { key: "week", label: "This week", from: week, stats: weekStats },
    { key: "month", label: "This month", from: month, stats: monthStats },
  ];
}

export type DailyActivity = {
  /** Local date in the sending timezone, `YYYY-MM-DD`. */
  day: string;
  sent: number;
  failed: number;
  opened: number;
  replied: number;
};

/** Per-day counts for the last `days` local days, today included, zero-filled. */
export async function getDailyActivity(days = 30, now = new Date()): Promise<DailyActivity[]> {
  const from = daysBefore(startOfSendDay(now), days - 1);
  const localDay = (column: string) =>
    Prisma.sql`to_char((${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC') AT TIME ZONE ${SEND_TIMEZONE}, 'YYYY-MM-DD')`;

  type Kind = Exclude<keyof DailyActivity, "day">;
  const rows = await prisma.$queryRaw<{ day: string; kind: Kind; count: number }[]>`
    SELECT day, kind, count(*)::int AS count FROM (
      SELECT ${localDay("sentAt")} AS day, 'sent' AS kind
        FROM "CampaignRecipient" WHERE "sentAt" >= ${utc(from)}
      UNION ALL
      SELECT ${localDay("updatedAt")}, 'failed'
        FROM "CampaignRecipient" WHERE "status" = 'FAILED' AND "updatedAt" >= ${utc(from)}
      UNION ALL
      SELECT ${localDay("firstOpenedAt")}, 'opened'
        FROM "CampaignRecipient" WHERE "firstOpenedAt" >= ${utc(from)}
      UNION ALL
      SELECT ${localDay("repliedAt")}, 'replied'
        FROM "CampaignRecipient" WHERE "repliedAt" >= ${utc(from)}
    ) activity
    GROUP BY day, kind
  `;

  const byDay = new Map<string, DailyActivity>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = localDateKey(daysBefore(startOfSendDay(now), offset));
    byDay.set(day, { day, sent: 0, failed: 0, opened: 0, replied: 0 });
  }
  for (const row of rows) {
    const entry = byDay.get(row.day);
    if (entry) entry[row.kind] = row.count;
  }
  return [...byDay.values()];
}

/** `YYYY-MM-DD` for an instant, as a calendar date in the sending timezone. */
function localDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SEND_TIMEZONE }).format(date);
}

/** Campaigns need this many sends before their rates are worth ranking. */
export const MIN_SENT_TO_RANK = 20;

/**
 * Campaigns ranked by reply rate, then open rate: replies are the signal
 * that matters for outreach, and opens break ties while replies are rare.
 */
export async function getTopCampaigns(limit = 5) {
  const [counts, failures] = await Promise.all([
    prisma.campaignRecipient.groupBy({
      by: ["campaignId"],
      _count: { sentAt: true, firstOpenedAt: true, repliedAt: true },
    }),
    prisma.campaignRecipient.groupBy({
      by: ["campaignId"],
      where: { status: "FAILED" },
      _count: { _all: true },
    }),
  ]);

  const ranked = counts
    .map((row) => {
      const sent = row._count.sentAt;
      return {
        campaignId: row.campaignId,
        sent,
        failed: failures.find((f) => f.campaignId === row.campaignId)?._count._all ?? 0,
        replied: row._count.repliedAt,
        openRate: rate(row._count.firstOpenedAt, sent),
        replyRate: rate(row._count.repliedAt, sent),
      };
    })
    .filter((row) => row.sent >= MIN_SENT_TO_RANK)
    .sort((a, b) => b.replyRate - a.replyRate || b.openRate - a.openRate || b.sent - a.sent)
    .slice(0, limit);

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: ranked.map((row) => row.campaignId) } },
    select: { id: true, name: true, status: true, template: { select: { name: true } } },
  });

  return ranked.flatMap((row) => {
    const campaign = campaigns.find((item) => item.id === row.campaignId);
    return campaign ? [{ ...row, campaign }] : [];
  });
}

export type CampaignStats = {
  total: number;
  pending: number;
  sent: number;
  opened: number;
  replied: number;
  failed: number;
  openRate: number;
  replyRate: number;
};

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const [total, pending, sent, opened, replied, failed] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    prisma.campaignRecipient.count({ where: { campaignId, sentAt: { not: null } } }),
    prisma.campaignRecipient.count({
      where: { campaignId, firstOpenedAt: { not: null } },
    }),
    prisma.campaignRecipient.count({ where: { campaignId, repliedAt: { not: null } } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "FAILED" } }),
  ]);

  return {
    total,
    pending,
    sent,
    opened,
    replied,
    failed,
    openRate: rate(opened, sent),
    replyRate: rate(replied, sent),
  };
}
