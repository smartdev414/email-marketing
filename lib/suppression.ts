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

function startOfToday() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return startOfDay;
}

/** How many more emails this mailbox may send today. */
export async function remainingDailyQuota(emailAccountId: string) {
  const [mailbox, sentToday] = await Promise.all([
    prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { dailyLimit: true },
    }),
    prisma.campaignRecipient.count({
      where: { emailAccountId, sentAt: { gte: startOfToday() } },
    }),
  ]);

  const limit = mailbox?.dailyLimit ?? DAILY_SEND_LIMIT;

  return {
    limit,
    sentToday,
    remaining: Math.max(0, limit - sentToday),
  };
}

/** Today's usage for many mailboxes at once, keyed by `EmailAccount.id`. */
export async function mailboxQuotas(mailboxes: { id: string; dailyLimit: number | null }[]) {
  const sent = await prisma.campaignRecipient.groupBy({
    by: ["emailAccountId"],
    where: {
      emailAccountId: { in: mailboxes.map((mailbox) => mailbox.id) },
      sentAt: { gte: startOfToday() },
    },
    _count: { _all: true },
  });

  const sentBy = new Map(sent.map((row) => [row.emailAccountId, row._count._all]));

  return new Map(
    mailboxes.map((mailbox) => {
      const limit = mailbox.dailyLimit ?? DAILY_SEND_LIMIT;
      const sentToday = sentBy.get(mailbox.id) ?? 0;
      return [mailbox.id, { limit, sentToday, remaining: Math.max(0, limit - sentToday) }];
    }),
  );
}
