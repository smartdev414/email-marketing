import { revalidatePath } from "next/cache";

import { fetchRecentInboxThreadIds, fetchThreadReplies, type ThreadReply } from "@/lib/mailer";
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
 * Background pass: for each connected mailbox, list what recently arrived in
 * its inbox and record replies on threads a campaign started there.
 */
export async function checkReplies({ deadline }: { deadline: number }) {
  const mailboxes = await prisma.emailAccount.findMany({
    where: {
      accessToken: { not: null },
      recipients: { some: { repliedAt: null, gmailThreadId: { not: null } } },
    },
    select: { id: true, email: true },
  });

  let checked = 0;
  let replies = 0;
  const errors: string[] = [];

  for (const mailbox of mailboxes) {
    if (Date.now() > deadline) break;

    try {
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
      errors.push(`${mailbox.email}: ${error instanceof Error ? error.message : "unreachable"}`);
    }
  }

  if (replies > 0) {
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
  }

  return { mailboxes: mailboxes.length, checked, replies, errors };
}
