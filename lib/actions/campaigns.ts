"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { REJECTION_LABELS, screenAddress, sendDelay, sleep } from "@/lib/deliverability";
import { isSuppressed, remainingDailyQuota, suppress } from "@/lib/suppression";
import { Prisma } from "@/lib/generated/prisma/client";
import { GoogleConnectionError } from "@/lib/google";
import { fetchBouncedAddresses, fetchThreadReplies, sendEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { buildVariables, renderTemplate } from "@/lib/template";
import { oneClickUnsubscribeUrl, textToHtml, withTracking } from "@/lib/tracking";

import type { ActionResult } from "./contacts";

const campaignSchema = z.object({
  name: z.string().trim().min(2, "Give the campaign a name").max(120),
  description: z.string().trim().max(300).optional(),
  templateId: z.string().min(1, "Pick a template"),
  /** How many contacts to draw at random from the pool. */
  audienceSize: z.number().int().min(1).max(5000),
  batchSize: z.number().int().min(1).max(500).default(50),
  /** Optional tag filter for the contact pool. */
  tag: z.string().trim().optional(),
  /** Skip contacts who have already been emailed by any campaign. */
  excludeContacted: z.boolean().default(true),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(true),
});

export type CampaignInput = z.input<typeof campaignSchema>;

/**
 * Counts how many contacts are eligible right now, so the campaign form can
 * show the size of the pool before anyone commits to a send.
 */
export async function countEligibleContacts(tag?: string, excludeContacted = true) {
  await requireUser();

  return prisma.contact.count({
    where: {
      status: "ACTIVE",
      ...(tag ? { tags: { has: tag } } : {}),
      ...(excludeContacted ? { recipients: { none: {} } } : {}),
    },
  });
}

/**
 * Creates a campaign and draws its audience at random. `ORDER BY random()` runs
 * the sampling inside Postgres so we never pull the whole contact table into
 * the app.
 */
export async function createCampaign(input: CampaignInput): Promise<
  { ok: true; id: string; picked: number } | { ok: false; error: string }
> {
  const user = await requireUser();

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
  }

  const {
    name,
    description,
    templateId,
    audienceSize,
    batchSize,
    tag,
    excludeContacted,
    trackOpens,
    trackClicks,
  } = parsed.data;

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return { ok: false, error: "Template not found" };

  const conditions = [Prisma.sql`c."status" = 'ACTIVE'`];
  if (tag) conditions.push(Prisma.sql`${tag} = ANY(c."tags")`);
  if (excludeContacted) {
    conditions.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "CampaignRecipient" r WHERE r."contactId" = c."id")`,
    );
  }

  const picked = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "Contact" c
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY random()
    LIMIT ${audienceSize}
  `;

  if (picked.length === 0) {
    return { ok: false, error: "No contacts match that audience — import contacts first." };
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      description: description || null,
      templateId,
      fromUserId: user.id,
      batchSize,
      trackOpens,
      trackClicks,
      recipients: {
        create: picked.map((contact) => ({
          contactId: contact.id,
          assignedToId: user.id,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath("/campaigns");
  return { ok: true, id: campaign.id, picked: picked.length };
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  await requireUser();

  await prisma.campaign.delete({ where: { id } });

  revalidatePath("/campaigns");
  return { ok: true };
}

export async function setCampaignPaused(id: string, paused: boolean): Promise<ActionResult> {
  await requireUser();

  await prisma.campaign.update({
    where: { id },
    data: { status: paused ? "PAUSED" : "SENDING" },
  });

  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true };
}

export type SendSummary =
  | {
      ok: true;
      sent: number;
      failed: number;
      skipped: number;
      remaining: number;
      quotaReached: boolean;
    }
  | { ok: false; error: string };

/**
 * Releases the next batch of pending emails for a campaign. Called from the
 * campaign page — clicking "Send next batch" repeatedly walks the audience,
 * which keeps each request short and stays inside Gmail's rate limits.
 */
export async function sendCampaignBatch(campaignId: string): Promise<SendSummary> {
  const user = await requireUser();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, fromUser: true },
  });

  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (campaign.status === "PAUSED") return { ok: false, error: "Campaign is paused" };

  // Daily cap per mailbox — the single most effective spam-prevention control.
  const quota = await remainingDailyQuota(user.id);
  if (quota.remaining === 0) {
    return {
      ok: false,
      error: `Daily limit reached (${quota.limit} emails). Sending resumes tomorrow.`,
    };
  }

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    take: Math.min(campaign.batchSize, quota.remaining),
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      ok: true,
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      quotaReached: false,
    };
  }

  if (campaign.status === "DRAFT") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "SENDING", startedAt: new Date() },
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, recipient] of pending.entries()) {
    // Never email someone who opted out between audience selection and send.
    if (recipient.contact.status !== "ACTIVE") {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: `Contact is ${recipient.contact.status}` },
      });
      skipped += 1;
      continue;
    }

    // Address screening + block list, re-checked at send time.
    const rejection = screenAddress(recipient.contact.email);
    if (rejection || (await isSuppressed(recipient.contact.email))) {
      const reason = REJECTION_LABELS[rejection ?? "suppressed"];
      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", error: `Skipped — ${reason}` },
        }),
        prisma.contact.update({
          where: { id: recipient.contactId },
          data: { status: "DO_NOT_CONTACT" },
        }),
      ]);
      skipped += 1;
      continue;
    }

    // Human-looking pacing between sends.
    if (index > 0) await sleep(sendDelay());

    const variables = buildVariables(recipient.contact, campaign.fromUser.name);
    const subject = renderTemplate(campaign.template.subject, variables);
    const html = withTracking(
      renderTemplate(textToHtml(campaign.template.body), variables),
      recipient.trackingToken,
      { opens: campaign.trackOpens, clicks: campaign.trackClicks },
    );

    try {
      const result = await sendEmail({
        userId: recipient.assignedToId ?? campaign.fromUserId ?? user.id,
        fromName: campaign.fromUser.name,
        to: recipient.contact.email,
        subject,
        html,
        unsubscribeUrl: oneClickUnsubscribeUrl(recipient.trackingToken),
      });

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            subject,
            sentAt: new Date(),
            gmailMessageId: result.messageId,
            gmailThreadId: result.threadId,
            error: null,
          },
        }),
        prisma.emailEvent.create({
          data: { recipientId: recipient.id, type: "SENT" },
        }),
      ]);

      sent += 1;
    } catch (error) {
      if (error instanceof GoogleConnectionError) {
        return { ok: false, error: error.message };
      }

      const message = error instanceof Error ? error.message : "Unknown send error";
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: message },
      });
      failed += 1;
    }
  }

  const remaining = await prisma.campaignRecipient.count({
    where: { campaignId, status: "PENDING" },
  });

  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");

  const quotaAfter = await remainingDailyQuota(user.id);

  return {
    ok: true,
    sent,
    failed,
    skipped,
    remaining,
    quotaReached: quotaAfter.remaining === 0 && remaining > 0,
  };
}

/**
 * Reads delivery failures out of Gmail, marks those recipients bounced, and adds
 * the address to the suppression list so no future campaign retries it.
 */
export async function syncBounces(): Promise<
  { ok: true; bounced: number } | { ok: false; error: string }
> {
  const user = await requireUser();

  let addresses: Map<string, Date>;
  try {
    addresses = await fetchBouncedAddresses(user.id);
  } catch (error) {
    if (error instanceof GoogleConnectionError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach Gmail",
    };
  }

  let bounced = 0;

  for (const [email, receivedAt] of addresses) {
    const contact = await prisma.contact.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!contact) continue;

    await suppress(email, "Hard bounce reported by Gmail");

    const updated = await prisma.campaignRecipient.updateMany({
      where: { contactId: contact.id, bouncedAt: null, sentAt: { not: null } },
      data: { status: "BOUNCED", bouncedAt: receivedAt },
    });

    await prisma.contact.update({
      where: { id: contact.id },
      data: { status: "BOUNCED" },
    });

    if (updated.count > 0) bounced += updated.count;
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true, bounced };
}

/**
 * Checks Gmail threads for inbound messages and marks recipients as replied.
 * Run it from the campaign page or the inbox.
 */
export async function syncReplies(campaignId?: string): Promise<
  { ok: true; replies: number } | { ok: false; error: string }
> {
  const user = await requireUser();

  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(campaignId ? { campaignId } : {}),
      assignedToId: user.id,
      gmailThreadId: { not: null },
      repliedAt: null,
      status: { in: ["SENT", "OPENED"] },
    },
    select: { id: true, gmailThreadId: true, contactId: true },
    take: 200,
  });

  let replies = 0;

  try {
    for (const recipient of recipients) {
      const inbound = await fetchThreadReplies(user.id, recipient.gmailThreadId!);
      if (inbound.length === 0) continue;

      const first = inbound[0];

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "REPLIED", repliedAt: first.receivedAt },
        }),
        prisma.emailEvent.create({
          data: { recipientId: recipient.id, type: "REPLY" },
        }),
        prisma.contact.update({
          where: { id: recipient.contactId },
          data: { status: "REPLIED" },
        }),
      ]);

      replies += 1;
    }
  } catch (error) {
    if (error instanceof GoogleConnectionError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach Gmail",
    };
  }

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);

  return { ok: true, replies };
}

/** Sends a one-off reply inside an existing conversation. */
export async function replyToRecipient(
  recipientId: string,
  body: string,
): Promise<ActionResult> {
  const user = await requireUser();

  if (body.trim().length < 2) return { ok: false, error: "Write a reply first" };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { contact: true },
  });

  if (!recipient) return { ok: false, error: "Conversation not found" };

  try {
    await sendEmail({
      userId: user.id,
      fromName: user.name,
      to: recipient.contact.email,
      subject: recipient.subject ? `Re: ${recipient.subject}` : "Re:",
      html: textToHtml(body),
      threadId: recipient.gmailThreadId,
      inReplyTo: recipient.gmailMessageId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not send the reply",
    };
  }

  revalidatePath("/inbox");
  return { ok: true };
}
