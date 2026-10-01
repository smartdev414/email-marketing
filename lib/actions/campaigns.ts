"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import {
  SEND_BUDGET_MS,
  sendCampaignBatch as sendBatch,
  type SendSummary,
} from "@/lib/campaign-sender";
import { suppress } from "@/lib/suppression";
import { Prisma } from "@/lib/generated/prisma/client";
import { GoogleConnectionError, isRevokedGrant, mailboxReady, mailboxSenderName } from "@/lib/google";
import { fetchBouncedAddresses, fetchThreadReplies, sendEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { recordReply } from "@/lib/replies";
import { textToHtml } from "@/lib/tracking";

import type { ActionResult } from "./contacts";

const campaignSchema = z.object({
  name: z.string().trim().min(2, "Give the campaign a name").max(120),
  description: z.string().trim().max(300).optional(),
  templateId: z.string().min(1, "Pick a template"),
  /** How many contacts to draw at random from the pool. */
  audienceSize: z.number().int().min(1).max(5000),
  batchSize: z.number().int().min(1).max(500).default(50),
  /** Skip contacts who have already been emailed by any campaign. */
  excludeContacted: z.boolean().default(true),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(true),
  /** Connected mailboxes the campaign rotates through. */
  senderIds: z.array(z.string().min(1)).min(1, "Pick at least one mailbox to send from"),
});

export type CampaignInput = z.input<typeof campaignSchema>;

/**
 * Counts how many contacts are eligible right now, so the campaign form can
 * show the size of the pool before anyone commits to a send.
 */
export async function countEligibleContacts(excludeContacted = true) {
  await requireUser();

  return prisma.contact.count({
    where: {
      status: "ACTIVE",
      ...(excludeContacted ? { recipients: { none: {} } } : {}),
    },
  });
}

/**
 * Draws an audience at random. `ORDER BY random()` runs the sampling inside
 * Postgres so we never pull the whole contact table into the app.
 */
async function drawAudience(audienceSize: number, excludeContacted: boolean) {
  const conditions = [Prisma.sql`c."status" = 'ACTIVE'`];
  if (excludeContacted) {
    conditions.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "CampaignRecipient" r WHERE r."contactId" = c."id")`,
    );
  }

  return prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "Contact" c
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY random()
    LIMIT ${audienceSize}
  `;
}

/** Creates a campaign and draws its audience at random. */
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
    excludeContacted,
    trackOpens,
    trackClicks,
    senderIds,
  } = parsed.data;

  // Only the creator's own, working mailboxes can be used as senders — replies
  // land in those inboxes and are worked from this user's Inbox page.
  const senders = await prisma.emailAccount.findMany({
    where: { id: { in: senderIds }, userId: user.id, isActive: true },
    select: { id: true, scope: true, refreshToken: true },
  });
  const usable = senders.filter(mailboxReady);
  if (usable.length === 0) {
    return { ok: false, error: "None of the selected mailboxes can send — reconnect them first." };
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return { ok: false, error: "Template not found" };

  const picked = await drawAudience(audienceSize, excludeContacted);

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
      senders: { connect: usable.map((sender) => ({ id: sender.id })) },
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

const campaignUpdateSchema = campaignSchema.pick({
  name: true,
  templateId: true,
  batchSize: true,
  trackOpens: true,
  trackClicks: true,
  senderIds: true,
});

export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>;

/**
 * Edits a campaign's settings. The audience is fixed once drawn; template,
 * mailbox and batch changes apply to the emails that have not gone out yet.
 */
export async function updateCampaign(
  id: string,
  input: CampaignUpdateInput,
): Promise<ActionResult> {
  await requireUser();

  const parsed = campaignUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
  }
  const { senderIds, ...fields } = parsed.data;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { fromUserId: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };

  // Same rule as creation: replies land in the owner's own mailboxes.
  const senders = await prisma.emailAccount.findMany({
    where: { id: { in: senderIds }, userId: campaign.fromUserId, isActive: true },
    select: { id: true, scope: true, refreshToken: true },
  });
  const usable = senders.filter(mailboxReady);
  if (usable.length === 0) {
    return { ok: false, error: "None of the selected mailboxes can send — reconnect them first." };
  }

  const template = await prisma.template.findUnique({ where: { id: fields.templateId } });
  if (!template) return { ok: false, error: "Template not found" };

  await prisma.campaign.update({
    where: { id },
    data: {
      ...fields,
      senders: { set: usable.map((sender) => ({ id: sender.id })) },
    },
  });

  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true };
}

/**
 * Copies a campaign's settings into a new draft with a fresh audience of the
 * same size. Contacts anyone has already emailed are skipped, so a duplicate
 * never sends the same people the same email twice.
 */
export async function duplicateCampaign(
  id: string,
): Promise<{ ok: true; id: string; picked: number } | { ok: false; error: string }> {
  await requireUser();

  const source = await prisma.campaign.findUnique({
    where: { id },
    include: {
      senders: { select: { id: true, isActive: true, scope: true, refreshToken: true } },
      _count: { select: { recipients: true } },
    },
  });
  if (!source) return { ok: false, error: "Campaign not found" };

  const usable = source.senders.filter((sender) => sender.isActive && mailboxReady(sender));
  if (usable.length === 0) {
    return { ok: false, error: "None of this campaign's mailboxes can send — reconnect them first." };
  }

  const picked = await drawAudience(Math.max(1, source._count.recipients), true);
  if (picked.length === 0) {
    return { ok: false, error: "Every active contact has already been emailed — import more first." };
  }

  const copy = await prisma.campaign.create({
    data: {
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      templateId: source.templateId,
      fromUserId: source.fromUserId,
      batchSize: source.batchSize,
      trackOpens: source.trackOpens,
      trackClicks: source.trackClicks,
      senders: { connect: usable.map((sender) => ({ id: sender.id })) },
      recipients: {
        create: picked.map((contact) => ({
          contactId: contact.id,
          assignedToId: source.fromUserId,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath("/campaigns");
  return { ok: true, id: copy.id, picked: picked.length };
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

/**
 * Hands a draft campaign to the background sender at `/api/cron/campaigns`,
 * which then releases it in small batches inside the sending window.
 */
export async function startCampaign(id: string): Promise<ActionResult> {
  await requireUser();

  const started = await prisma.campaign.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "SENDING", startedAt: new Date() },
  });
  if (started.count === 0) return { ok: false, error: "Only draft campaigns can be started" };

  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true };
}

/**
 * Releases the next batch of pending emails for a campaign. Called from the
 * campaign page; the background sender at `/api/cron/campaigns` keeps going
 * on its own once a campaign is sending.
 */
export async function sendCampaignBatch(campaignId: string): Promise<SendSummary> {
  await requireUser();

  return sendBatch(campaignId, { deadline: Date.now() + SEND_BUDGET_MS });
}

/**
 * Reads delivery failures out of Gmail, marks those recipients bounced, and adds
 * the address to the suppression list so no future campaign retries it.
 */
export async function syncBounces(): Promise<
  { ok: true; bounced: number; warning?: string } | { ok: false; error: string }
> {
  const user = await requireUser();

  const mailboxes = await prisma.emailAccount.findMany({
    where: { userId: user.id },
    select: { id: true, email: true },
  });

  if (mailboxes.length === 0) {
    return { ok: false, error: "Connect a mailbox on the Integrations page first." };
  }

  // Bounce notices land in whichever mailbox sent the email, so check them all.
  const addresses = new Map<string, Date>();
  const unreachable: string[] = [];

  for (const mailbox of mailboxes) {
    try {
      const found = await fetchBouncedAddresses(mailbox.id);
      for (const [email, receivedAt] of found) {
        if (!addresses.has(email)) addresses.set(email, receivedAt);
      }
    } catch {
      unreachable.push(mailbox.email);
    }
  }

  if (unreachable.length === mailboxes.length) {
    return { ok: false, error: "Could not reach Gmail — reconnect your mailboxes." };
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
  return {
    ok: true,
    bounced,
    ...(unreachable.length > 0 ? { warning: `Could not check ${unreachable.join(", ")}` } : {}),
  };
}

/**
 * Checks Gmail threads for inbound messages and marks recipients as replied.
 * Run it from the campaign page or the inbox.
 */
export async function syncReplies(campaignId?: string): Promise<
  { ok: true; replies: number; warning?: string } | { ok: false; error: string }
> {
  const user = await requireUser();

  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(campaignId ? { campaignId } : {}),
      assignedToId: user.id,
      emailAccountId: { not: null },
      gmailThreadId: { not: null },
      repliedAt: null,
      status: { in: ["SENT", "OPENED"] },
    },
    select: {
      id: true,
      gmailThreadId: true,
      emailAccountId: true,
      emailAccount: { select: { email: true } },
    },
    take: 200,
  });

  let replies = 0;
  let lastError: string | null = null;
  // Thread ids only exist inside the mailbox that sent them, and one broken
  // mailbox should not stop the others from syncing.
  const unreachable = new Set<string>();

  for (const recipient of recipients) {
    const mailboxId = recipient.emailAccountId!;
    const mailboxEmail = recipient.emailAccount?.email ?? mailboxId;
    if (unreachable.has(mailboxEmail)) continue;

    let inbound;
    try {
      inbound = await fetchThreadReplies(mailboxId, recipient.gmailThreadId!);
    } catch (error) {
      if (error instanceof GoogleConnectionError || isRevokedGrant(error)) {
        unreachable.add(mailboxEmail);
      }
      lastError = error instanceof Error ? error.message : "Could not reach Gmail";
      continue;
    }

    if (inbound.length === 0) continue;

    // Same path as the background checker, so a manual check also notifies.
    if (await recordReply(recipient.id, inbound[0])) replies += 1;
  }

  if (replies === 0 && lastError) {
    return { ok: false, error: lastError };
  }

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);

  return {
    ok: true,
    replies,
    ...(unreachable.size > 0
      ? { warning: `Could not check ${[...unreachable].join(", ")} — reconnect it.` }
      : {}),
  };
}

/** Sends a one-off reply inside an existing conversation. */
export async function replyToRecipient(
  recipientId: string,
  body: string,
): Promise<ActionResult> {
  await requireUser();

  if (body.trim().length < 2) return { ok: false, error: "Write a reply first" };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { contact: true, emailAccount: true },
  });

  if (!recipient) return { ok: false, error: "Conversation not found" };

  // The reply has to leave from the mailbox that owns the thread.
  if (!recipient.emailAccount) {
    return {
      ok: false,
      error: "The mailbox this conversation was sent from is no longer connected.",
    };
  }

  try {
    await sendEmail({
      emailAccountId: recipient.emailAccount.id,
      fromName: await mailboxSenderName(recipient.emailAccount),
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
