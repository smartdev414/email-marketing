import { getGmail } from "@/lib/google";
import { buildMime, findAddresses } from "@/lib/mail/mime";
import type { MailboxRef, SendOptions, SendResult, ThreadReply } from "@/lib/mail/types";

function base64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmail(
  mailbox: MailboxRef,
  { fromName, to, subject, html, threadId, inReplyTo, unsubscribeUrl }: SendOptions,
): Promise<SendResult> {
  const gmail = await getGmail(mailbox.id);

  const raw = buildMime({
    fromAddress: mailbox.email,
    fromName,
    to,
    subject,
    html,
    inReplyTo,
    unsubscribeUrl,
  });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: base64Url(raw),
      ...(threadId ? { threadId } : {}),
    },
  });

  return {
    messageId: response.data.id ?? "",
    threadId: response.data.threadId ?? "",
  };
}

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Returns inbound messages on a thread — i.e. the contact's replies, skipping
 * anything we sent ourselves.
 */
export async function gmailThreadReplies(
  mailbox: MailboxRef,
  threadId: string,
): Promise<ThreadReply[]> {
  const gmail = await getGmail(mailbox.id);

  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "metadata",
    metadataHeaders: ["From", "Date", "Subject"],
  });

  const messages = thread.data.messages ?? [];

  return messages
    .filter((message) => !message.labelIds?.includes("SENT"))
    .filter((message) => !/mailer-daemon|postmaster/i.test(
      headerValue(message.payload?.headers, "From"),
    ))
    .map((message) => ({
      messageId: message.id ?? "",
      from: headerValue(message.payload?.headers, "From"),
      snippet: message.snippet ?? "",
      receivedAt: message.internalDate
        ? new Date(Number(message.internalDate))
        : new Date(),
    }));
}

/**
 * Thread ids of mail that recently landed in the inbox from someone else. One
 * list call per mailbox, so the background checker only opens threads that
 * actually have something new instead of every thread it ever sent.
 */
export async function gmailRecentInboxThreadIds(mailbox: MailboxRef, days: number) {
  const gmail = await getGmail(mailbox.id);
  const threadIds = new Set<string>();
  let pageToken: string | undefined;

  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: `in:inbox -from:me newer_than:${days}d`,
      maxResults: 500,
      pageToken,
    });
    for (const message of list.data.messages ?? []) {
      if (message.threadId) threadIds.add(message.threadId);
    }
    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && threadIds.size < 2000);

  return threadIds;
}

/**
 * Reads delivery-failure notices out of the mailbox. Gmail has no bounce API,
 * so we look for mailer-daemon mail and pull the failed recipient out of the
 * `X-Failed-Recipients` header (or the snippet as a fallback).
 */
export async function gmailBouncedAddresses(mailbox: MailboxRef, days: number) {
  const gmail = await getGmail(mailbox.id);

  const list = await gmail.users.messages.list({
    userId: "me",
    q: `from:(mailer-daemon OR postmaster) newer_than:${days}d`,
    maxResults: 100,
  });

  const bounced = new Map<string, Date>();

  for (const item of list.data.messages ?? []) {
    if (!item.id) continue;

    const message = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["X-Failed-Recipients", "To", "Subject"],
    });

    const failedHeader = headerValue(message.data.payload?.headers, "X-Failed-Recipients");
    const failed = findAddresses(failedHeader);
    const candidates = failed.length > 0 ? failed : findAddresses(message.data.snippet);

    const receivedAt = message.data.internalDate
      ? new Date(Number(message.data.internalDate))
      : new Date();

    for (const address of candidates) {
      const normalized = address.toLowerCase();
      if (/mailer-daemon|postmaster|googlemail\.com$/i.test(normalized)) continue;
      if (!bounced.has(normalized)) bounced.set(normalized, receivedAt);
    }
  }

  return bounced;
}
