import { revalidatePath } from "next/cache";

import {
  fetchRecentInboxThreadIds,
  fetchSendLimitNotices,
  fetchThreadReplies,
  type ThreadReply,
} from "@/lib/mailer";
import {
  isBlockedAccount,
  pauseBlockedMailbox,
  providerLabel,
  SEND_LIMIT_ERROR,
} from "@/lib/mailbox";
import { notify } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Reply detection, shared by the "Check replies" buttons and the background
 * job at `/api/cron/campaigns`. Deliberately not a `"use server"` module:
 * nothing here checks who is calling.
 */

/** Gmail snippets come HTML-escaped (`&#39;`, `&amp;` …). */
function decodeSnippet(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"Jane Doe" <jane@x.com>` → `Jane Doe`; a bare address stays as it is. */
function displayName(fromHeader: string) {
  const match = fromHeader.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return match?.[1]?.trim() || fromHeader.replace(/[<>]/g, "").trim();
}

/**
 * Marks a recipient as replied and notifies whoever owns the conversation:
 * "Jane Doe replied to von dayrit" with the start of the reply. Returns false
 * when the reply was already recorded.
 */
export async function recordReply(recipientId: string, reply: ThreadReply) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: {
      id: true,
      contactId: true,
      assignedToId: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      emailAccount: { select: { email: true, fromName: true, userId: true } },
      campaign: { select: { name: true, fromUserId: true } },
    },
  });
  if (!recipient) return false;

  // Guarded update, so the button and the background job never both count it.
  const marked = await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, repliedAt: null },
    data: { status: "REPLIED", repliedAt: reply.receivedAt },
  });
  if (marked.count === 0) return false;

  await prisma.$transaction([
    prisma.emailEvent.create({ data: { recipientId, type: "REPLY" } }),
    prisma.contact.update({ where: { id: recipient.contactId }, data: { status: "REPLIED" } }),
  ]);

  const replier =
    [recipient.contact.firstName, recipient.contact.lastName].filter(Boolean).join(" ") ||
    displayName(reply.from) ||
    recipient.contact.email;
  const senderName =
    recipient.emailAccount?.fromName || recipient.emailAccount?.email || "your mailbox";
  const snippet = decodeSnippet(reply.snippet);

  await notify({
    userId:
      recipient.assignedToId ?? recipient.emailAccount?.userId ?? recipient.campaign.fromUserId,
    type: "REPLY_RECEIVED",
    title: `${replier} replied to ${senderName}`,
    body: snippet
      ? snippet.length > 180
        ? `${snippet.slice(0, 177)}…`
        : snippet
      : `New reply on “${recipient.campaign.name}”.`,
    url: `/inbox#reply-${recipientId}`,
    dedupeKey: `reply:${recipientId}`,
  });

  return true;
}

/**
 * A limit notice arrives seconds after the send; follow-ups go out days later.
 * It can also be stamped a moment before `sentAt`, which is recorded only once
 * the provider's API call returns.
 */
const NOTICE_WINDOW_MS = 30 * 60_000;
const NOTICE_EARLY_MS = 2 * 60_000;

/**
 * The provider accepted these emails, then refused to deliver them because the
 * mailbox hit its sending limit. They were never sent: they become FAILED
 * (without a send time, so they leave the Sent counts) and the mailbox is
 * paused so it stops trying. The recipients did nothing wrong, so nothing is
 * suppressed. Returns how many recipients were corrected.
 */
async function recordUnsent(
  mailbox: { id: string; email: string; provider: string; userId: string },
  notices: Map<string, Date>,
) {
  const label = providerLabel(mailbox);

  // Only the email the notice answers: one sent shortly before it. An earlier
  // email in the same thread was delivered, and an opened one plainly was.
  const candidates = await prisma.campaignRecipient.findMany({
    where: {
      emailAccountId: mailbox.id,
      gmailThreadId: { in: [...notices.keys()] },
      status: "SENT",
      repliedAt: null,
    },
    select: { id: true, gmailThreadId: true, sentAt: true },
  });
  const refused = candidates.filter((recipient) => {
    const noticeAt = notices.get(recipient.gmailThreadId!)?.getTime() ?? 0;
    const sentAt = recipient.sentAt?.getTime() ?? 0;
    const gap = noticeAt - sentAt;
    return sentAt > 0 && gap >= -NOTICE_EARLY_MS && gap <= NOTICE_WINDOW_MS;
  });
  if (refused.length === 0) return 0;

  const unsent = await prisma.campaignRecipient.updateMany({
    where: { id: { in: refused.map((recipient) => recipient.id) }, status: "SENT" },
    data: {
      status: "FAILED",
      sentAt: null,
      error: `Not sent — ${label} refused it: the mailbox hit its sending limit`,
    },
  });
  if (unsent.count === 0) return 0;

  await prisma.emailAccount.update({
    where: { id: mailbox.id },
    data: { isActive: false, lastError: SEND_LIMIT_ERROR },
  });
  await notify({
    userId: mailbox.userId,
    type: "MAILBOX_LIMIT_REACHED",
    title: `${mailbox.email} hit ${label}'s sending limit`,
    body: `${label} refused to deliver ${unsent.count} email${unsent.count === 1 ? "" : "s"}, now marked failed. The mailbox is paused; lower its daily limit before switching it back on.`,
    url: "/integrations",
    dedupeKey: `send-limit:${mailbox.id}:${new Date().toISOString().slice(0, 10)}`,
  });
  return unsent.count;
}

/**
 * Background pass: for each connected mailbox, list what recently arrived in
 * its inbox and record replies on threads a campaign started there.
 */
export async function checkReplies({ deadline }: { deadline: number }) {
  const mailboxes = await prisma.emailAccount.findMany({
    where: {
      accessToken: { not: null },
      recipients: { some: { repliedAt: null, gmailThreadId: { not: null } } },
    },
    select: { id: true, email: true, provider: true, userId: true },
  });

  let checked = 0;
  let replies = 0;
  let unsent = 0;
  const errors: string[] = [];

  for (const mailbox of mailboxes) {
    if (Date.now() > deadline) break;

    try {
      const limited = await fetchSendLimitNotices(mailbox.id);
      if (limited.size > 0) unsent += await recordUnsent(mailbox, limited);

      const threadIds = await fetchRecentInboxThreadIds(mailbox.id);
      checked += 1;
      if (threadIds.size === 0) continue;

      const waiting = await prisma.campaignRecipient.findMany({
        where: {
          emailAccountId: mailbox.id,
          gmailThreadId: { in: [...threadIds] },
          repliedAt: null,
          status: { in: ["SENT", "OPENED"] },
        },
        select: { id: true, gmailThreadId: true },
      });

      for (const recipient of waiting) {
        if (Date.now() > deadline) break;
        const inbound = await fetchThreadReplies(mailbox.id, recipient.gmailThreadId!);
        if (inbound.length > 0 && (await recordReply(recipient.id, inbound[0]))) replies += 1;
      }
    } catch (error) {
      // Caught here too, so a blocked mailbox is paused even between campaigns.
      if (isBlockedAccount(error)) await pauseBlockedMailbox(mailbox, error);
      errors.push(`${mailbox.email}: ${error instanceof Error ? error.message : "unreachable"}`);
    }
  }

  if (replies > 0 || unsent > 0) {
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
  }

  return { mailboxes: mailboxes.length, checked, replies, unsent, errors };
}
