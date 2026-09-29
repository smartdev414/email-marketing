"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { REJECTION_LABELS, screenAddress, sendDelay, sleep } from "@/lib/deliverability";
import { isSuppressed, mailboxQuotas, suppress } from "@/lib/suppression";
import { Prisma } from "@/lib/generated/prisma/client";
import { GoogleConnectionError, isRevokedGrant, mailboxReady } from "@/lib/google";
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

  const conditions = [Prisma.sql`c."status" = 'ACTIVE'`];
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
      warning?: string;
    }
  | { ok: false; error: string };

/**
 * Releases the next batch of pending emails for a campaign. Called from the
 * campaign page — clicking "Send next batch" repeatedly walks the audience,
 * which keeps each request short and stays inside Gmail's rate limits.
 *
 * Sends rotate round-robin across the campaign's mailboxes, each capped at its
 * own daily limit, so no single inbox carries enough volume to look like spam.
 */
export async function sendCampaignBatch(campaignId: string): Promise<SendSummary> {
  await requireUser();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: true,
      fromUser: true,
      senders: {
        where: { isActive: true },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (campaign.status === "PAUSED") return { ok: false, error: "Campaign is paused" };

  const ready = campaign.senders.filter(mailboxReady);
  if (ready.length === 0) {
    return {
      ok: false,
      error: "This campaign has no active, connected mailboxes. Check the Integrations page.",
    };
  }

  // Daily cap per mailbox — the single most effective spam-prevention control.
  const quotas = await mailboxQuotas(ready);
  const rotation = ready
    .map((sender) => ({ sender, remaining: quotas.get(sender.id)?.remaining ?? 0 }))
    .filter((slot) => slot.remaining > 0)
    // Mailbox with the most room goes first so volume evens out over the day.
    .sort((a, b) => b.remaining - a.remaining);

  const capacity = rotation.reduce((total, slot) => total + slot.remaining, 0);
  if (capacity === 0) {
    return {
      ok: false,
      error: "Every mailbox on this campaign hit its daily limit. Sending resumes tomorrow.",
    };
  }

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    take: Math.min(campaign.batchSize, capacity),
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
  let attempts = 0;
  let cursor = 0;
  const brokenMailboxes: string[] = [];

  /** Next mailbox in the rotation that still has room today. */
  function nextSlot() {
    for (let step = 0; step < rotation.length; step += 1) {
      const slot = rotation[(cursor + step) % rotation.length];
      if (slot.remaining > 0) {
        cursor = (cursor + step + 1) % rotation.length;
        return slot;
      }
    }
    return null;
  }

  for (const recipient of pending) {
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

    const slot = nextSlot();
    if (!slot) break;
    const { sender } = slot;

    // Human-looking pacing between sends.
    if (attempts > 0) await sleep(sendDelay());
    attempts += 1;

    const senderName = sender.fromName ?? sender.user.name ?? campaign.fromUser.name;
    const variables = buildVariables(recipient.contact, senderName);
    const subject = renderTemplate(campaign.template.subject, variables);
    const html = withTracking(
      renderTemplate(textToHtml(campaign.template.body), variables),
      recipient.trackingToken,
      { opens: campaign.trackOpens, clicks: campaign.trackClicks },
    );

    try {
      const result = await sendEmail({
        emailAccountId: sender.id,
        fromName: senderName,
        to: recipient.contact.email,
        subject,
        html,
        unsubscribeUrl: oneClickUnsubscribeUrl(recipient.trackingToken),
      });

      slot.remaining -= 1;

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            subject,
            sentAt: new Date(),
            emailAccountId: sender.id,
            assignedToId: sender.userId,
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
      // A dead mailbox is not the recipient's fault: drop the mailbox from the
      // rotation and leave the recipient queued for the next batch.
      if (error instanceof GoogleConnectionError || isRevokedGrant(error)) {
        slot.remaining = 0;
        brokenMailboxes.push(sender.email);
        await prisma.emailAccount.update({
          where: { id: sender.id },
          data: {
            lastError: error instanceof Error ? error.message : "Mailbox disconnected",
          },
        });
        continue;
      }

      const message = error instanceof Error ? error.message : "Unknown send error";
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: message },
      });
      failed += 1;
    }
  }

  revalidatePath("/integrations");

  if (sent === 0 && brokenMailboxes.length > 0 && rotation.every((slot) => slot.remaining === 0)) {
    return {
      ok: false,
      error: `Could not send from ${brokenMailboxes.join(", ")} — reconnect on the Integrations page.`,
    };
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

  return {
    ok: true,
    sent,
    failed,
    skipped,
    remaining,
    quotaReached: rotation.every((slot) => slot.remaining === 0) && remaining > 0,
    ...(brokenMailboxes.length > 0
      ? { warning: `Skipped disconnected mailbox: ${brokenMailboxes.join(", ")}` }
      : {}),
  };
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
      contactId: true,
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
  const user = await requireUser();

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
      fromName: recipient.emailAccount.fromName ?? user.name,
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
