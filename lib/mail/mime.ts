import { htmlToText } from "@/lib/tracking";

/** RFC 2047 encodes a header value when it contains non-ASCII characters. */
function encodeHeader(value: string) {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export type MimeOptions = {
  fromAddress: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  /** RFC 5322 Message-ID of the message being answered. */
  inReplyTo?: string | null;
  /** Enables RFC 8058 one-click unsubscribe — a real deliverability signal. */
  unsubscribeUrl?: string | null;
};

/**
 * A multipart/alternative message (plain text + HTML). Both Gmail and Outlook
 * accept it as-is, which is how the List-Unsubscribe headers get through:
 * Graph's JSON message format only allows custom `X-` headers.
 */
export function buildMime({
  fromAddress,
  fromName,
  to,
  subject,
  html,
  inReplyTo,
  unsubscribeUrl,
}: MimeOptions) {
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

  return [
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
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function findAddresses(text: string | null | undefined) {
  return text?.match(EMAIL_PATTERN) ?? [];
}
