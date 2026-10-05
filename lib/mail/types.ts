/** The mailbox fields every provider implementation needs. */
export type MailboxRef = {
  id: string;
  email: string;
};

export type SendOptions = {
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  /** Set when replying inside an existing conversation. */
  threadId?: string | null;
  /** Provider id of the message being answered (`gmailMessageId`). */
  inReplyTo?: string | null;
  /** Enables RFC 8058 one-click unsubscribe — a real deliverability signal. */
  unsubscribeUrl?: string | null;
};

/**
 * Gmail: message and thread ids. Outlook: the sent message's immutable id and
 * its `conversationId`. Both are stored in `gmailMessageId` / `gmailThreadId`.
 */
export type SendResult = {
  messageId: string;
  threadId: string;
};

export type ThreadReply = {
  messageId: string;
  from: string;
  snippet: string;
  receivedAt: Date;
};
