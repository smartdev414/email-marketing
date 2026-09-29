import { getGmail, GoogleConnectionError } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { htmlToText } from "@/lib/tracking";

/** RFC 2047 encodes a header value when it contains non-ASCII characters. */
function encodeHeader(value: string) {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type SendOptions = {
  /** Connected mailbox (`EmailAccount.id`) the email goes out from. */
  emailAccountId: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  /** Set when replying inside an existing conversation. */
  threadId?: string | null;
  inReplyTo?: string | null;
  /** Enables RFC 8058 one-click unsubscribe — a real deliverability signal. */
  unsubscribeUrl?: string | null;
};

export type SendResult = {
  messageId: string;
  threadId: string;
};

export async function sendEmail({
  emailAccountId,
  fromName,
  to,
  subject,
  html,
  threadId,
  inReplyTo,
  unsubscribeUrl,
}: SendOptions): Promise<SendResult> {
  const mailbox = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { email: true },
  });
  if (!mailbox) throw new GoogleConnectionError();

  const gmail = await getGmail(emailAccountId);
  const fromAddress = mailbox.email;

  const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${fromAddress}>` : fromAddress}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  }

  if (unsubscribeUrl) {
    headers.push(
      `List-Unsubscribe: <${unsubscribeUrl}>`,
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
  }

  const raw = [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    htmlToText(html),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

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

export type ThreadReply = {
  messageId: string;
  from: string;
  snippet: string;
  receivedAt: Date;
};

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
export async function fetchThreadReplies(
  emailAccountId: string,
  threadId: string,
): Promise<ThreadReply[]> {
  const gmail = await getGmail(emailAccountId);

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

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Reads delivery-failure notices out of the mailbox. Gmail has no bounce API,
 * so we look for mailer-daemon mail and pull the failed recipient out of the
 * `X-Failed-Recipients` header (or the snippet as a fallback).
 */
export async function fetchBouncedAddresses(emailAccountId: string, days = 14) {
  const gmail = await getGmail(emailAccountId);

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
    const candidates =
      failedHeader.match(EMAIL_PATTERN) ?? message.data.snippet?.match(EMAIL_PATTERN) ?? [];

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
