import { prisma } from "@/lib/prisma";

export function rate(part: number, whole: number) {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export async function getDashboardStats() {
  const [contacts, activeContacts, campaigns, sent, opened, replied, failed, recentCampaigns] =
    await Promise.all([
      prisma.contact.count(),
      prisma.contact.count({ where: { status: "ACTIVE" } }),
      prisma.campaign.count(),
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

  return {
    contacts,
    activeContacts,
    campaigns,
    sent,
    opened,
    replied,
    failed,
    openRate: rate(opened, sent),
    replyRate: rate(replied, sent),
    recentCampaigns,
  };
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
