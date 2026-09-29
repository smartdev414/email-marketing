import { DAILY_SEND_LIMIT, emailParts } from "@/lib/deliverability";
import { prisma } from "@/lib/prisma";

/**
 * Database-backed half of the deliverability guardrails. Kept apart from
 * `lib/deliverability.ts` so the pure checks stay importable from client
 * components without pulling Prisma into the browser bundle.
 */

/** True when the address or its domain is on the block list. */
export async function isSuppressed(email: string) {
  const { domain } = emailParts(email);

  const hit = await prisma.suppression.findFirst({
    where: {
      OR: [
        { type: "EMAIL", value: email.toLowerCase().trim() },
        { type: "DOMAIN", value: domain },
      ],
    },
    select: { id: true },
  });

  return Boolean(hit);
}

export async function suppress(
  email: string,
  reason: string,
  type: "EMAIL" | "DOMAIN" = "EMAIL",
) {
  const value = type === "EMAIL" ? email.toLowerCase().trim() : emailParts(email).domain;

  await prisma.suppression.upsert({
    where: { type_value: { type, value } },
    update: { reason },
    create: { type, value, reason },
  });
}

/** How many more emails this mailbox may send today. */
export async function remainingDailyQuota(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const sentToday = await prisma.campaignRecipient.count({
    where: { assignedToId: userId, sentAt: { gte: startOfDay } },
  });

  return {
    limit: DAILY_SEND_LIMIT,
    sentToday,
    remaining: Math.max(0, DAILY_SEND_LIMIT - sentToday),
  };
}
