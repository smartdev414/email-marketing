import { gmailProfileName } from "@/lib/google";
import {
  gmailBouncedAddresses,
  gmailRecentInboxThreadIds,
  gmailThreadReplies,
  sendGmail,
} from "@/lib/mail/gmail";
import {
  outlookBouncedAddresses,
  outlookRecentInboxThreadIds,
  outlookThreadReplies,
  sendOutlook,
} from "@/lib/mail/outlook";
import type { MailboxRef, SendOptions, SendResult, ThreadReply } from "@/lib/mail/types";
import { MailboxConnectionError, providerOf } from "@/lib/mailbox";
import { outlookProfileName } from "@/lib/microsoft";
import { prisma } from "@/lib/prisma";

/**
 * One entry point for every mailbox, whatever its provider. Callers pass a
 * mailbox id; this looks up whether it is Gmail or Outlook and hands the call
 * to `lib/mail/gmail.ts` or `lib/mail/outlook.ts`.
 */

export type { SendResult, ThreadReply };

async function findMailbox(emailAccountId: string) {
  const mailbox = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { id: true, email: true, provider: true },
  });
  if (!mailbox) throw new MailboxConnectionError();
  const ref: MailboxRef = { id: mailbox.id, email: mailbox.email };
  return { mailbox: ref, outlook: providerOf(mailbox) === "microsoft" };
}

export async function sendEmail({
  emailAccountId,
  ...options
}: SendOptions & {
  /** Connected mailbox (`EmailAccount.id`) the email goes out from. */
  emailAccountId: string;
}): Promise<SendResult> {
  const { mailbox, outlook } = await findMailbox(emailAccountId);
  return outlook ? sendOutlook(mailbox, options) : sendGmail(mailbox, options);
}

/**
 * Returns inbound messages on a thread — i.e. the contact's replies, skipping
 * anything we sent ourselves.
 */
export async function fetchThreadReplies(
  emailAccountId: string,
  threadId: string,
): Promise<ThreadReply[]> {
  const { mailbox, outlook } = await findMailbox(emailAccountId);
  return outlook ? outlookThreadReplies(mailbox, threadId) : gmailThreadReplies(mailbox, threadId);
}

/**
 * Thread ids of mail that recently landed in the inbox from someone else. One
 * list call per mailbox, so the background checker only opens threads that
 * actually have something new instead of every thread it ever sent.
 */
export async function fetchRecentInboxThreadIds(emailAccountId: string, days = 3) {
  const { mailbox, outlook } = await findMailbox(emailAccountId);
  return outlook
    ? outlookRecentInboxThreadIds(mailbox, days)
    : gmailRecentInboxThreadIds(mailbox, days);
}

/** Failed recipient addresses from recent delivery-failure notices. */
export async function fetchBouncedAddresses(emailAccountId: string, days = 14) {
  const { mailbox, outlook } = await findMailbox(emailAccountId);
  return outlook ? outlookBouncedAddresses(mailbox, days) : gmailBouncedAddresses(mailbox, days);
}

/**
 * The display name a mailbox sends as: its custom From name, else the
 * account's own profile name. Mailboxes saved without a name look it up once
 * and store it, so recipients never see the app user's name instead.
 */
export async function mailboxSenderName(mailbox: {
  id: string;
  provider: string;
  fromName: string | null;
}) {
  if (mailbox.fromName) return mailbox.fromName;

  try {
    const name =
      providerOf(mailbox) === "microsoft"
        ? await outlookProfileName(mailbox.id)
        : await gmailProfileName(mailbox.id);

    if (name) {
      await prisma.emailAccount.update({ where: { id: mailbox.id }, data: { fromName: name } });
      mailbox.fromName = name;
    }
    return name;
  } catch (error) {
    console.error("Could not read the mailbox profile name", error);
    return null;
  }
}
