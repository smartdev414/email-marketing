/**
 * Deliverability guardrails. Cold outreach gets filtered on volume, content and
 * list hygiene, so every send goes through these checks.
 */

/** Per-mailbox daily cap. Gmail's hard limit is far higher, but 30–50/day per
 *  mailbox is what keeps a cold-outreach domain out of the spam folder. */
export const DAILY_SEND_LIMIT = Number(process.env.DAILY_SEND_LIMIT ?? 50);

/** Milliseconds to pause between sends so a batch does not look automated. */
export const MIN_SEND_GAP_MS = Number(process.env.MIN_SEND_GAP_MS ?? 4_000);
export const MAX_SEND_GAP_MS = Number(process.env.MAX_SEND_GAP_MS ?? 12_000);

/** Shared mailboxes — emailing these reliably earns spam complaints. */
const ROLE_ADDRESSES = new Set([
  "abuse",
  "admin",
  "administrator",
  "all",
  "billing",
  "compliance",
  "contact",
  "dmarc",
  "everyone",
  "help",
  "hostmaster",
  "info",
  "legal",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "postmaster",
  "privacy",
  "root",
  "security",
  "spam",
  "staff",
  "support",
  "team",
  "webmaster",
]);

/** Throwaway domains — a bounce waiting to happen. */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

export function emailParts(email: string) {
  const [localPart = "", domain = ""] = email.toLowerCase().trim().split("@");
  return { localPart, domain };
}

export function isRoleAddress(email: string) {
  const { localPart } = emailParts(email);
  return ROLE_ADDRESSES.has(localPart);
}

export function isDisposableDomain(email: string) {
  const { domain } = emailParts(email);
  return DISPOSABLE_DOMAINS.has(domain);
}

/** A cheap syntax check — catches the typos that make up most bounces. */
export function looksDeliverable(email: string) {
  return /^[^\s@,;]+@[^\s@,;.]+\.[a-z]{2,}$/i.test(email.trim());
}

export type AddressRejection = "invalid" | "role" | "disposable" | "suppressed";

export function screenAddress(email: string): AddressRejection | null {
  if (!looksDeliverable(email)) return "invalid";
  if (isRoleAddress(email)) return "role";
  if (isDisposableDomain(email)) return "disposable";
  return null;
}

export const REJECTION_LABELS: Record<AddressRejection, string> = {
  invalid: "not a valid address",
  role: "shared/role mailbox",
  disposable: "disposable domain",
  suppressed: "on the suppression list",
};

/** Random pause between sends. */
export function sendDelay() {
  const spread = Math.max(0, MAX_SEND_GAP_MS - MIN_SEND_GAP_MS);
  return MIN_SEND_GAP_MS + Math.floor(Math.random() * spread);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Words and patterns that trip spam filters. This is a writing aid shown in the
 * template editor, not a hard gate.
 */
const SPAM_TERMS = [
  "act now",
  "apply now",
  "buy now",
  "cash bonus",
  "cheap",
  "click here",
  "congratulations",
  "credit card",
  "dear friend",
  "discount",
  "double your",
  "earn money",
  "for free",
  "free trial",
  "get paid",
  "guarantee",
  "limited time",
  "lowest price",
  "make money",
  "no cost",
  "no obligation",
  "offer expires",
  "one time",
  "risk free",
  "special promotion",
  "urgent",
  "winner",
  "work from home",
];

export type ContentWarning = { level: "warn" | "info"; message: string };

/** Lints subject + body for the things that most often land mail in spam. */
export function checkContent(subject: string, body: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const haystack = `${subject}\n${body}`.toLowerCase();

  const hits = SPAM_TERMS.filter((term) => haystack.includes(term));
  if (hits.length > 0) {
    warnings.push({
      level: "warn",
      message: `Spam-trigger wording: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? "…" : ""}`,
    });
  }

  if (/[A-Z]{5,}/.test(subject)) {
    warnings.push({ level: "warn", message: "Subject shouts in capitals." });
  }

  if ((subject.match(/[!?]/g) ?? []).length > 1) {
    warnings.push({ level: "warn", message: "Too much punctuation in the subject." });
  }

  if (subject.length > 60) {
    warnings.push({
      level: "info",
      message: "Subject is long — under 60 characters reads better on mobile.",
    });
  }

  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words > 200) {
    warnings.push({
      level: "info",
      message: `${words} words. Cold emails under 120 words get more replies.`,
    });
  }

  const links = (body.match(/https?:\/\//g) ?? []).length;
  if (links > 2) {
    warnings.push({
      level: "warn",
      message: `${links} links. One link per cold email is safest.`,
    });
  }

  if (/<img/i.test(body)) {
    warnings.push({
      level: "warn",
      message: "Images in a first-touch cold email hurt deliverability.",
    });
  }

  return warnings;
}
