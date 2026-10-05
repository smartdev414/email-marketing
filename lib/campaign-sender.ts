import { revalidatePath } from "next/cache";

import { REJECTION_LABELS, screenAddress, sendDelay, sleep } from "@/lib/deliverability";
import { isRevokedGrant, MailboxConnectionError, mailboxReady, providerLabel } from "@/lib/mailbox";
import { mailboxSenderName, sendEmail } from "@/lib/mailer";
import { notify, sendDayKey } from "@/lib/notifications";
import { describeSendWindow, isWithinSendWindow } from "@/lib/send-window";
import { prisma } from "@/lib/prisma";
import { isSuppressed, mailboxQuotas } from "@/lib/suppression";
import { buildVariables, renderTemplate } from "@/lib/template";
import { oneClickUnsubscribeUrl, textToHtml, withTracking } from "@/lib/tracking";

/**
 * Campaign sending, shared by the "Send next batch" button and the background
 * sender at `/api/cron/campaigns`. Deliberately not a `"use server"` module:
 * nothing here checks who is calling, so it must never be exposed as an action.
 */

/** Platform request limit is 300s; stop well before it so results get saved. */
export const SEND_BUDGET_MS = Number(process.env.SEND_BUDGET_MS ?? 240_000);

/** Room left for one mailbox API call plus the database writes that follow it. */
const SEND_HEADROOM_MS = 20_000;

/** A crashed run releases its campaign once this lease runs out. */
const LOCK_LEASE_MS = 6 * 60_000;

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

type BatchOptions = {
  /** Epoch ms after which no new send is started. */
  deadline: number;
  /** Caps the batch below the campaign's own `batchSize`. */
  limit?: number;
  /**
   * Released by hand from the campaign page ("Send next N"): ignores the
   * sending window, and may send from a campaign that was only auto-paused.
   */
  manual?: boolean;
};

/**
 * Releases the next batch of pending emails for a campaign.
 *
 * Sends rotate round-robin across the campaign's mailboxes, each capped at its
 * own daily limit, so no single inbox carries enough volume to look like spam.
 */
export async function sendCampaignBatch(
  campaignId: string,
  { deadline, limit, manual = false }: BatchOptions,
): Promise<SendSummary> {
  if (!manual && !isWithinSendWindow()) {
    return { ok: false, error: `Outside sending hours (${describeSendWindow()}).` };
  }

  const now = new Date();
  const lock = await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      OR: [{ sendLockedUntil: null }, { sendLockedUntil: { lt: now } }],
    },
    data: { sendLockedUntil: new Date(now.getTime() + LOCK_LEASE_MS) },
  });

  if (lock.count === 0) {
    const exists = await prisma.campaign.count({ where: { id: campaignId } });
    return exists
      ? { ok: false, error: "A batch for this campaign is already going out — try again shortly." }
      : { ok: false, error: "Campaign not found" };
  }

  try {
    return await sendLockedBatch(campaignId, { deadline, limit, manual });
  } finally {
    await prisma.campaign.updateMany({
      where: { id: campaignId },
      data: { sendLockedUntil: null },
    });
  }
}

async function sendLockedBatch(
  campaignId: string,
  { deadline, limit, manual = false }: BatchOptions,
): Promise<SendSummary> {
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
      variants: { where: { isActive: true }, select: { id: true, subject: true, body: true } },
    },
  });

  if (!campaign) return { ok: false, error: "Campaign not found" };
  // An auto-pause only means "outside sending hours", which a manual send ignores.
  if (campaign.status === "PAUSED" && !(manual && campaign.autoPausedAt)) {
    return { ok: false, error: "Campaign is paused" };
  }

  const ready = campaign.senders.filter(mailboxReady);
  if (ready.length === 0) {
    return {
      ok: false,
      error: "This campaign has no active, connected mailboxes. Check the Integrations page.",
    };
  }

  // Daily cap per mailbox — the single most effective spam-prevention control.
  const quotas = await mailboxQuotas(ready);
  const day = sendDayKey();
  const slots = ready.map((sender) => ({
    sender,
    remaining: quotas.get(sender.id)?.remaining ?? 0,
    limit: quotas.get(sender.id)?.limit ?? 0,
  }));

  // A mailbox can also run out through replies or another campaign, so check
  // here too; the dedupe key keeps it to one alert per mailbox per day.
  for (const slot of slots) {
    if (slot.remaining <= 0) await notifyLimitReached(slot, day);
  }

  const rotation = slots
    .filter((slot) => slot.remaining > 0)
    // Mailbox with the most room goes first so volume evens out over the day.
    .sort((a, b) => b.remaining - a.remaining);

  const capacity = rotation.reduce((total, slot) => total + slot.remaining, 0);
  if (capacity === 0) {
    await notifyOutOfCapacity(campaign, day);
    return {
      ok: false,
      error: "Every mailbox on this campaign hit its daily limit. Sending resumes tomorrow.",
    };
  }

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { contact: true },
    take: Math.min(campaign.batchSize, capacity, limit ?? Infinity),
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date(), autoPausedAt: null },
    });
    await notifyCompleted(campaign);
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

  // The template plus its active AI variations, picked at random per email so
  // the same wording does not go to every recipient.
  const versions = [
    { id: null, subject: campaign.template.subject, body: campaign.template.body },
    ...campaign.variants,
  ];

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

    // Human-looking pacing between sends, as long as the request has time left.
    const delay = attempts > 0 ? sendDelay() : 0;
    if (Date.now() + delay + SEND_HEADROOM_MS > deadline) break;
    if (!manual && !isWithinSendWindow(new Date(Date.now() + delay))) break;

    const slot = nextSlot();
    if (!slot) break;
    const { sender } = slot;

    if (delay > 0) await sleep(delay);
    attempts += 1;

    const senderName = await mailboxSenderName(sender);
    const variables = buildVariables(recipient.contact, senderName);
    const version = versions[Math.floor(Math.random() * versions.length)];
    const subject = renderTemplate(version.subject, variables);
    const html = withTracking(
      renderTemplate(textToHtml(version.body), variables),
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
      if (slot.remaining === 0) await notifyLimitReached(slot, day);

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            subject,
            sentAt: new Date(),
            emailAccountId: sender.id,
            assignedToId: sender.userId,
            variantId: version.id,
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
      if (error instanceof MailboxConnectionError || isRevokedGrant(error)) {
        slot.remaining = 0;
        brokenMailboxes.push(sender.email);
        await prisma.emailAccount.update({
          where: { id: sender.id },
          data: {
            lastError: error instanceof Error ? error.message : "Mailbox disconnected",
          },
        });
        await notify({
          userId: sender.userId,
          type: "MAILBOX_DISCONNECTED",
          title: `${sender.email} needs reconnecting`,
          body: `${providerLabel(sender)} rejected it while sending “${campaign.name}”. Reconnect it on the Integrations page.`,
          url: "/integrations",
          dedupeKey: `disconnected:${sender.id}:${day}`,
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
      data: { status: "COMPLETED", completedAt: new Date(), autoPausedAt: null },
    });
    await notifyCompleted(campaign);
  }

  const quotaReached = rotation.every((slot) => slot.remaining === 0) && remaining > 0;
  if (quotaReached) await notifyOutOfCapacity(campaign, day);

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");

  return {
    ok: true,
    sent,
    failed,
    skipped,
    remaining,
    quotaReached,
    ...(brokenMailboxes.length > 0
      ? { warning: `Skipped disconnected mailbox: ${brokenMailboxes.join(", ")}` }
      : {}),
  };
}

type CampaignRef = { id: string; name: string; fromUserId: string };

function notifyLimitReached(
  slot: { sender: { id: string; userId: string; email: string }; limit: number },
  day: string,
) {
  return notify({
    userId: slot.sender.userId,
    type: "MAILBOX_LIMIT_REACHED",
    title: `${slot.sender.email} sent all ${slot.limit} emails`,
    body: "It hit today's sending limit and picks up again tomorrow.",
    url: "/integrations",
    dedupeKey: `limit:${slot.sender.id}:${day}`,
  });
}

function notifyOutOfCapacity(campaign: CampaignRef, day: string) {
  return notify({
    userId: campaign.fromUserId,
    type: "CAMPAIGN_OUT_OF_CAPACITY",
    title: `“${campaign.name}” is done for today`,
    body: "Every mailbox on this campaign hit its daily limit. Sending resumes tomorrow.",
    url: `/campaigns/${campaign.id}`,
    dedupeKey: `capacity:${campaign.id}:${day}`,
  });
}

function notifyCompleted(campaign: CampaignRef) {
  return notify({
    userId: campaign.fromUserId,
    type: "CAMPAIGN_COMPLETED",
    title: `“${campaign.name}” is complete`,
    body: "Every recipient in the audience has been sent to.",
    url: `/campaigns/${campaign.id}`,
    dedupeKey: `completed:${campaign.id}`,
  });
}

function revalidateCampaignLists() {
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
}

/** Emails each campaign may release per background run, spreading volume over the day. */
const CRON_SENDS_PER_RUN = Number(process.env.CRON_SENDS_PER_RUN ?? 5);

export type CampaignRunResult = {
  campaignId: string;
  name: string;
} & SendSummary;

/**
 * One pass of the background sender: a small batch for every campaign that is
 * currently sending. Campaigns enter this loop once someone starts them from
 * the campaign page; paused and completed ones are left alone.
 *
 * It also follows the sending window: outside it, sending campaigns are
 * auto-paused; inside it, the campaigns it auto-paused are resumed. Campaigns
 * someone paused by hand have no `autoPausedAt` and are never resumed here.
 */
export async function runCampaignSends(budgetMs = SEND_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;

  if (!isWithinSendWindow()) {
    const paused = await prisma.campaign.updateMany({
      where: { status: "SENDING" },
      data: { status: "PAUSED", autoPausedAt: new Date() },
    });
    if (paused.count > 0) revalidateCampaignLists();
    return {
      campaigns: 0,
      processed: 0,
      sent: 0,
      results: [],
      autoPaused: paused.count,
      skipped: `outside ${describeSendWindow()}`,
    };
  }

  const resumed = await prisma.campaign.updateMany({
    where: { status: "PAUSED", autoPausedAt: { not: null } },
    data: { status: "SENDING", autoPausedAt: null },
  });
  if (resumed.count > 0) revalidateCampaignLists();

  const campaigns = await prisma.campaign.findMany({
    where: { status: "SENDING" },
    select: { id: true, name: true },
    // Whoever waited longest goes first if the time budget runs out.
    orderBy: { updatedAt: "asc" },
  });

  const results: CampaignRunResult[] = [];

  for (const campaign of campaigns) {
    if (Date.now() + SEND_HEADROOM_MS > deadline) break;

    try {
      const summary = await sendCampaignBatch(campaign.id, {
        deadline,
        limit: CRON_SENDS_PER_RUN,
      });
      results.push({ campaignId: campaign.id, name: campaign.name, ...summary });
    } catch (error) {
      results.push({
        campaignId: campaign.id,
        name: campaign.name,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    campaigns: campaigns.length,
    autoResumed: resumed.count,
    processed: results.length,
    sent: results.reduce((total, result) => total + (result.ok ? result.sent : 0), 0),
    results,
  };
}
