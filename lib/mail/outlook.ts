import { buildMime, findAddresses } from "@/lib/mail/mime";
import type { MailboxRef, SendOptions, SendResult, ThreadReply } from "@/lib/mail/types";
import { getGraph, GraphError, type Graph } from "@/lib/microsoft";

/**
 * Outlook over Microsoft Graph. `sendMail` answers 202 with no ids, so every
 * send goes draft → send instead: creating the draft returns the message's
 * (immutable) id and its `conversationId`, which play the part of Gmail's
 * message and thread ids for reply detection and follow-ups.
 */

type GraphMessage = {
  id: string;
  conversationId: string;
  isDraft?: boolean;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null;
};

type GraphList<T> = { value: T[]; "@odata.nextLink"?: string };

function addressOf(message: GraphMessage) {
  return message.from?.emailAddress?.address?.toLowerCase() ?? "";
}

/** Same shape as Gmail's From header, so reply notifications read the same. */
function fromHeader(message: GraphMessage) {
  const name = message.from?.emailAddress?.name?.trim();
  const address = message.from?.emailAddress?.address ?? "";
  return name && name.toLowerCase() !== address.toLowerCase() ? `"${name}" <${address}>` : address;
}

const SYSTEM_SENDER = /mailer-daemon|postmaster|microsoftexchange/i;

function sinceIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** `$filter` values are OData string literals: single quotes are doubled. */
function odataString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function listAll<T>(graph: Graph, path: string, max: number) {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next && items.length < max) {
    const page: GraphList<T> = await graph<GraphList<T>>(next);
    items.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return items;
}

async function sendDraft(graph: Graph, draft: GraphMessage): Promise<SendResult> {
  await graph(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
  return { messageId: draft.id, threadId: draft.conversationId };
}

/**
 * Follow-ups and inbox replies answer the message we sent, so Outlook keeps
 * them in the same conversation. Graph's JSON format cannot carry
 * List-Unsubscribe, but these are in-thread replies that still carry the
 * unsubscribe link in the footer.
 */
async function replyInThread(
  graph: Graph,
  mailbox: MailboxRef,
  originalId: string,
  { fromName, to, subject, html }: SendOptions,
) {
  const draft = await graph<GraphMessage>(
    `/me/messages/${encodeURIComponent(originalId)}/createReply`,
    {
      method: "POST",
      body: {
        message: {
          // Replying to our own sent message would otherwise address it to us.
          toRecipients: [{ emailAddress: { address: to } }],
          subject,
          body: { contentType: "HTML", content: html },
          ...(fromName ? { from: { emailAddress: { name: fromName, address: mailbox.email } } } : {}),
        },
      },
    },
  );
  return sendDraft(graph, draft);
}

export async function sendOutlook(mailbox: MailboxRef, options: SendOptions): Promise<SendResult> {
  const graph = await getGraph(mailbox.id);

  if (options.inReplyTo) {
    try {
      return await replyInThread(graph, mailbox, options.inReplyTo, options);
    } catch (error) {
      // The original was deleted from Sent Items: send a fresh message instead.
      if (!(error instanceof GraphError && error.status === 404)) throw error;
    }
  }

  // A MIME draft keeps our List-Unsubscribe headers, which JSON drafts cannot.
  const mime = buildMime({
    fromAddress: mailbox.email,
    fromName: options.fromName,
    to: options.to,
    subject: options.subject,
    html: options.html,
    unsubscribeUrl: options.unsubscribeUrl,
  });

  const draft = await graph<GraphMessage>("/me/messages", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: Buffer.from(mime, "utf8").toString("base64"),
  });

  return sendDraft(graph, draft);
}

/** Inbound messages in a conversation, oldest first — the contact's replies. */
export async function outlookThreadReplies(
  mailbox: MailboxRef,
  conversationId: string,
): Promise<ThreadReply[]> {
  const graph = await getGraph(mailbox.id);
  const own = mailbox.email.toLowerCase();

  const filter = encodeURIComponent(`conversationId eq ${odataString(conversationId)}`);
  const messages = await listAll<GraphMessage>(
    graph,
    `/me/messages?$filter=${filter}&$select=id,conversationId,from,bodyPreview,receivedDateTime,isDraft&$top=50`,
    200,
  );

  return messages
    .filter((message) => !message.isDraft)
    .filter((message) => addressOf(message) && addressOf(message) !== own)
    .filter((message) => !SYSTEM_SENDER.test(addressOf(message)))
    .map((message) => ({
      messageId: message.id,
      from: fromHeader(message),
      snippet: message.bodyPreview ?? "",
      receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** Conversation ids of mail that recently landed in the inbox from someone else. */
export async function outlookRecentInboxThreadIds(mailbox: MailboxRef, days: number) {
  const graph = await getGraph(mailbox.id);
  const own = mailbox.email.toLowerCase();

  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso(days)}`);
  const messages = await listAll<GraphMessage>(
    graph,
    `/me/mailFolders/inbox/messages?$filter=${filter}&$select=conversationId,from&$top=500`,
    2000,
  );

  const threadIds = new Set<string>();
  for (const message of messages) {
    if (message.conversationId && addressOf(message) !== own) threadIds.add(message.conversationId);
  }
  return threadIds;
}

const BOUNCE_SUBJECT =
  /^(undeliverable|undelivered|delivery has failed|delivery status notification|mail delivery failed|returned mail|failure notice)/i;

/**
 * Reads non-delivery reports out of the inbox. Exchange NDRs come from
 * postmaster with an "Undeliverable:" subject and name the failed address at
 * the start of the body ("Your message to x@y.com couldn't be delivered").
 */
export async function outlookBouncedAddresses(mailbox: MailboxRef, days: number) {
  const graph = await getGraph(mailbox.id);
  const own = mailbox.email.toLowerCase();

  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso(days)}`);
  const messages = await listAll<GraphMessage>(
    graph,
    `/me/mailFolders/inbox/messages?$filter=${filter}&$select=subject,from,bodyPreview,receivedDateTime&$top=250`,
    1000,
  );

  const bounced = new Map<string, Date>();

  for (const message of messages) {
    const isNotice =
      SYSTEM_SENDER.test(addressOf(message)) || BOUNCE_SUBJECT.test(message.subject ?? "");
    if (!isNotice) continue;

    const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();

    for (const address of findAddresses(message.bodyPreview)) {
      const normalized = address.toLowerCase().replace(/\.$/, "");
      if (normalized === own || SYSTEM_SENDER.test(normalized)) continue;
      if (/(\.|^)(prod|protection)\.outlook\.com$/i.test(normalized)) continue;
      if (!bounced.has(normalized)) bounced.set(normalized, receivedAt);
    }
  }

  return bounced;
}
