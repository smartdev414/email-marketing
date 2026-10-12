import { gmailCapabilities } from "@/auth.config";
import { prisma } from "@/lib/prisma";

/**
 * Provider-neutral mailbox helpers. `EmailAccount.provider` says which API a
 * mailbox talks to; everything that only needs to know "can it send?" goes
 * through here instead of the Gmail, Outlook or SMTP modules.
 */

export type MailboxProvider = "google" | "microsoft" | "smtp";

export const PROVIDER_LABELS: Record<MailboxProvider, string> = {
  google: "Gmail",
  microsoft: "Outlook",
  smtp: "SMTP",
};

export function providerOf(mailbox: { provider: string }): MailboxProvider {
  if (mailbox.provider === "microsoft" || mailbox.provider === "smtp") return mailbox.provider;
  return "google";
}

export function providerLabel(mailbox: { provider: string }) {
  return PROVIDER_LABELS[providerOf(mailbox)];
}

export class MailboxConnectionError extends Error {
  constructor(message = "Mailbox is not connected. Reconnect it on the Integrations page.") {
    super(message);
    this.name = "MailboxConnectionError";
  }
}

/**
 * The mail server is refusing for now (a 4xx answer such as a sending limit,
 * or no connection) rather than refusing the recipient. The email should
 * wait for a later batch instead of being marked failed.
 */
export class MailboxBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxBusyError";
  }
}

/**
 * Delegated Microsoft Graph scopes. Every send creates a draft first (to learn
 * the message and conversation ids), which needs `Mail.ReadWrite`; `Mail.Send`
 * sends it. `Mail.ReadWrite` also covers reading replies and bounce notices.
 * `offline_access` is what makes Microsoft return a refresh token.
 */
export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.ReadWrite",
].join(" ");

/**
 * Microsoft reports Graph scopes either bare (`Mail.Send`) or fully qualified
 * (`https://graph.microsoft.com/Mail.Send`), in any case. Sending needs
 * `Mail.ReadWrite` too, because each email starts as a draft.
 */
export function outlookCapabilities(scope: string | null | undefined) {
  const granted = new Set(
    (scope ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => value.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()),
  );

  return {
    canSend: granted.has("mail.send") && granted.has("mail.readwrite"),
    canRead: granted.has("mail.read") || granted.has("mail.readwrite"),
  };
}

/**
 * SMTP mailboxes have no OAuth scopes; connecting one stores `SMTP_SCOPE`
 * once both servers accepted the login, and a disconnect clears it.
 */
export const SMTP_SCOPE = "smtp imap";

function smtpCapabilities(scope: string | null | undefined) {
  const granted = new Set((scope ?? "").split(/\s+/));
  return { canSend: granted.has("smtp"), canRead: granted.has("imap") };
}

export function mailboxCapabilities(mailbox: { provider: string; scope: string | null }) {
  const provider = providerOf(mailbox);
  if (provider === "smtp") return smtpCapabilities(mailbox.scope);
  return provider === "microsoft"
    ? outlookCapabilities(mailbox.scope)
    : gmailCapabilities(mailbox.scope);
}

/**
 * True when a stored grant lets us send and read, and can be refreshed. SMTP
 * mailboxes log in with a password, so there is nothing to refresh.
 */
export function mailboxReady(mailbox: {
  provider: string;
  scope: string | null;
  refreshToken: string | null;
}) {
  const { canSend, canRead } = mailboxCapabilities(mailbox);
  const renewable = providerOf(mailbox) === "smtp" || Boolean(mailbox.refreshToken);
  return canSend && canRead && renewable;
}

/** True when the team member has at least one mailbox ready to send. */
export async function hasMailboxAccess(userId: string) {
  const mailboxes = await prisma.emailAccount.findMany({
    where: { userId, isActive: true },
    select: { provider: true, scope: true, refreshToken: true },
  });

  return mailboxes.some(mailboxReady);
}

/**
 * Google and Microsoft both answer `invalid_grant` once a refresh token is
 * revoked or expired; Microsoft adds AADSTS codes for the same thing, and
 * Graph answers `ErrorAccessDenied` when the grant lacks a permission. The
 * mailbox has to be reconnected — retrying will not help, and the recipient
 * is not at fault.
 */
export function isRevokedGrant(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant|invalid_client|unauthorized_client|interaction_required|AADSTS(50173|50076|65001|70000|70008|700082|700084)|Outlook 40[13] (ErrorAccessDenied|InvalidAuthenticationToken)/i.test(
    message,
  );
}
