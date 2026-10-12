import { randomUUID } from "node:crypto";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";

import { findAddresses } from "@/lib/mail/mime";
import type { MailboxRef, SendOptions, SendResult, ThreadReply } from "@/lib/mail/types";
import { MailboxBusyError, MailboxConnectionError } from "@/lib/mailbox";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { htmlToText } from "@/lib/tracking";

/**
 * Any other provider (Namecheap Private Email, Zoho, cPanel hosting …) over
 * plain SMTP + IMAP. There are no provider ids here, so the RFC 5322
 * Message-ID plays both parts: `messageId` is the id of the email we sent and
 * `threadId` is the id of the first email in the conversation. Replies name
 * those ids in their References / In-Reply-To headers, which is how we find
 * them again in the inbox.
 */

export type SmtpSettings = {
  email: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
};

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 };

const SYSTEM_SENDER = /mailer-daemon|postmaster/i;

async function loadSettings(mailbox: MailboxRef): Promise<SmtpSettings> {
  const row = await prisma.emailAccount.findUnique({
    where: { id: mailbox.id },
    select: {
      accessToken: true,
      smtpHost: true,
      smtpPort: true,
      imapHost: true,
      imapPort: true,
    },
  });

  const password = decryptSecret(row?.accessToken);
  if (!row || !password || !row.smtpHost || !row.smtpPort || !row.imapHost || !row.imapPort) {
    throw new MailboxConnectionError();
  }

  return {
    email: mailbox.email,
    password,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
  };
}

/**
 * A rejected login has to be fixed by reconnecting, like a revoked OAuth
 * grant, so it becomes a `MailboxConnectionError` that takes the mailbox out
 * of rotation. Anything else (timeouts, a refused recipient) passes through.
 */
function connectionError(error: unknown, email: string) {
  const failure = error as { code?: string; authenticationFailed?: boolean };
  if (failure?.code === "EAUTH" || failure?.authenticationFailed) {
    return new MailboxConnectionError(
      `The mail server rejected the password for ${email}. Reconnect it on the Integrations page.`,
    );
  }
  return error;
}

function transport(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    // 465 is TLS from the first byte; 587 and 25 upgrade with STARTTLS.
    secure: settings.smtpPort === 465,
    requireTLS: settings.smtpPort !== 465,
    auth: { user: settings.email, pass: settings.password },
    ...TIMEOUTS,
  });
}

async function withImap<T>(settings: SmtpSettings, run: (client: ImapFlow) => Promise<T>) {
  const client = new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapPort === 993,
    auth: { user: settings.email, pass: settings.password },
    logger: false,
    ...TIMEOUTS,
  });

  try {
    await client.connect();
  } catch (error) {
    throw connectionError(error, settings.email);
  }

  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Runs `run` with INBOX selected. */
function withInbox<T>(settings: SmtpSettings, run: (client: ImapFlow) => Promise<T>) {
  return withImap(settings, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await run(client);
    } finally {
      lock.release();
    }
  });
}

/** Logs in to the outgoing server without sending anything. */
export async function verifySmtpLogin(settings: SmtpSettings) {
  try {
    await transport(settings).verify();
  } catch (error) {
    throw connectionError(error, settings.email);
  }
}

/** Logs in to the incoming server and out again. */
export async function verifyImapLogin(settings: SmtpSettings) {
  await withImap(settings, async () => undefined);
}

/**
 * SMTP only delivers; it does not file a copy anywhere. Appending to the Sent
 * folder keeps webmail showing the whole conversation. Best effort: the email
 * is already on its way.
 */
async function saveToSent(settings: SmtpSettings, raw: Buffer) {
  try {
    await withImap(settings, async (client) => {
      const folders = await client.list();
      const sent =
        folders.find((folder) => folder.specialUse === "\\Sent") ??
        folders.find((folder) => /^(inbox[./])?sent( items| messages)?$/i.test(folder.path));
      if (sent) await client.append(sent.path, raw, ["\\Seen"]);
    });
  } catch (error) {
    console.error(`Could not save a sent copy for ${settings.email}`, error);
  }
}

export async function sendSmtp(mailbox: MailboxRef, options: SendOptions): Promise<SendResult> {
  const settings = await loadSettings(mailbox);
  const domain = settings.email.split("@")[1] ?? "localhost";
  const messageId = `<${randomUUID()}@${domain}>`;

  const references = [...new Set([options.threadId, options.inReplyTo].filter(Boolean))];

  // Nodemailer handles the encoding (line length, non-ASCII) strict SMTP servers enforce.
  const raw = await new MailComposer({
    from: options.fromName ? { name: options.fromName, address: settings.email } : settings.email,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: htmlToText(options.html),
    messageId,
    ...(options.inReplyTo
      ? { inReplyTo: options.inReplyTo, references: references as string[] }
      : {}),
    ...(options.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${options.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  })
    .compile()
    .build();

  try {
    await transport(settings).sendMail({
      envelope: { from: settings.email, to: options.to },
      raw,
    });
  } catch (error) {
    const failure = error as { code?: string; responseCode?: number };
    const temporary =
      (failure?.responseCode !== undefined &&
        failure.responseCode >= 400 &&
        failure.responseCode < 500) ||
      ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(failure?.code ?? "");
    if (temporary && failure?.code !== "EAUTH") {
      throw new MailboxBusyError(
        `${settings.email} could not send right now: ${error instanceof Error ? error.message : "server unavailable"}`,
      );
    }
    throw connectionError(error, settings.email);
  }

  await saveToSent(settings, raw);

  return { messageId, threadId: options.threadId || messageId };
}

function senderOf(envelope: { from?: { name?: string; address?: string }[] } | undefined) {
  const from = envelope?.from?.[0];
  const address = from?.address ?? "";
  const name = from?.name?.trim();
  return {
    address: address.toLowerCase(),
    header:
      name && name.toLowerCase() !== address.toLowerCase() ? `"${name}" <${address}>` : address,
  };
}

/** The reply's own words: quoted history and the "On … wrote:" line dropped. */
async function snippetOf(source: Buffer | undefined) {
  if (!source) return "";
  try {
    const parsed = await simpleParser(source);
    const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : "");
    const ownLines = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*>/.test(line) || /^\s*On .+wrote:\s*$/i.test(line)) break;
      ownLines.push(line);
    }
    return ownLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

/** Inbound messages in a conversation, oldest first — the contact's replies. */
export async function smtpThreadReplies(
  mailbox: MailboxRef,
  threadId: string,
): Promise<ThreadReply[]> {
  const settings = await loadSettings(mailbox);
  const own = settings.email.toLowerCase();

  return withInbox(settings, async (client) => {
    const uids =
      (await client.search(
        { or: [{ header: { references: threadId } }, { header: { "in-reply-to": threadId } }] },
        { uid: true },
      )) || [];
    if (uids.length === 0) return [];

    const messages = await client.fetchAll(
      uids,
      { envelope: true, internalDate: true, source: { maxLength: 64_000 } },
      { uid: true },
    );

    const replies: ThreadReply[] = [];
    for (const message of messages) {
      const sender = senderOf(message.envelope);
      if (!sender.address || sender.address === own || SYSTEM_SENDER.test(sender.address)) continue;

      replies.push({
        messageId: message.envelope?.messageId ?? "",
        from: sender.header,
        snippet: await snippetOf(message.source),
        receivedAt: message.internalDate ? new Date(message.internalDate) : new Date(),
      });
    }

    return replies.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  });
}

const MESSAGE_ID = /<[^<>\s]+>/g;

/**
 * Conversation ids that recently got mail from someone else: every
 * Message-ID a new inbox message says it answers. One of them is the
 * `threadId` we stored when the conversation started.
 */
export async function smtpRecentInboxThreadIds(mailbox: MailboxRef, days: number) {
  const settings = await loadSettings(mailbox);
  const own = settings.email.toLowerCase();

  return withInbox(settings, async (client) => {
    const threadIds = new Set<string>();
    const since = new Date(Date.now() - days * 86_400_000);
    const uids = ((await client.search({ since }, { uid: true })) || []).slice(-2000);
    if (uids.length === 0) return threadIds;

    const messages = await client.fetchAll(
      uids,
      { envelope: true, headers: ["references", "in-reply-to"] },
      { uid: true },
    );

    for (const message of messages) {
      if (senderOf(message.envelope).address === own) continue;
      for (const id of message.headers?.toString("utf8").match(MESSAGE_ID) ?? []) {
        threadIds.add(id);
      }
    }
    return threadIds;
  });
}

const BOUNCE_SUBJECTS = [
  "Undeliver",
  "Delivery Status Notification",
  "Mail delivery failed",
  "Returned mail",
  "failure notice",
];

/**
 * Reads delivery-failure notices out of the inbox. Standard DSNs name the
 * failed address in `Final-Recipient`; Exim adds `X-Failed-Recipients`; for
 * anything else we fall back to the addresses at the start of the notice.
 */
export async function smtpBouncedAddresses(mailbox: MailboxRef, days: number) {
  const settings = await loadSettings(mailbox);
  const own = settings.email.toLowerCase();

  return withInbox(settings, async (client) => {
    const bounced = new Map<string, Date>();
    const since = new Date(Date.now() - days * 86_400_000);
    const uids =
      (await client.search(
        {
          since,
          or: [
            { from: "mailer-daemon" },
            { from: "postmaster" },
            ...BOUNCE_SUBJECTS.map((subject) => ({ subject })),
          ],
        },
        { uid: true },
      )) || [];
    if (uids.length === 0) return bounced;

    const messages = await client.fetchAll(
      uids.slice(-200),
      { internalDate: true, source: { maxLength: 64_000 } },
      { uid: true },
    );

    for (const message of messages) {
      const source = message.source?.toString("utf8") ?? "";
      const receivedAt = message.internalDate ? new Date(message.internalDate) : new Date();

      const reported = [
        ...source.matchAll(
          /^(?:Final-Recipient|X-Failed-Recipients):[^\r\n]*?([\w.+-]+@[\w-]+\.[\w.-]+)/gim,
        ),
      ].map((match) => match[1]);

      let candidates = reported;
      if (candidates.length === 0 && message.source) {
        const parsed = await simpleParser(message.source).catch(() => null);
        candidates = findAddresses(parsed?.text?.slice(0, 1000));
      }

      for (const address of candidates) {
        const normalized = address.toLowerCase().replace(/\.$/, "");
        if (normalized === own || SYSTEM_SENDER.test(normalized)) continue;
        if (!bounced.has(normalized)) bounced.set(normalized, receivedAt);
      }
    }

    return bounced;
  });
}
