import { checkContent, SPAM_TERMS } from "@/lib/deliverability";
import { TEMPLATE_VARIABLES } from "@/lib/template";

/**
 * AI rewording of a campaign template. The sender rotates the template and
 * its variations so the exact same text does not go out to every recipient.
 *
 * Only the middle of the email is rewritten. The greeting, the sign-off, every
 * link and every {{variable}} are kept exactly as written, and a variation
 * that breaks any of those rules is dropped instead of saved.
 */

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-nano";
const OPENAI_TIMEOUT_MS = 90_000;

/** Most variations a campaign rotates through; more adds noise, not reach. */
export const MAX_ACTIVE_VARIANTS = 10;

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

type TemplateParts = { greeting: string; middle: string; signoff: string };

/**
 * Splits a plain-text body into the parts that stay fixed and the part the AI
 * may reword. A short one-line first paragraph is the greeting; a short last
 * paragraph is the sign-off. Anything else counts as the message.
 */
export function splitTemplate(body: string): TemplateParts {
  const paragraphs = body.trim().split(/\n\s*\n/);
  let start = 0;
  let end = paragraphs.length;

  const first = paragraphs[0] ?? "";
  if (end - start > 1 && !first.includes("\n") && first.length <= 60) start += 1;

  const last = paragraphs[end - 1] ?? "";
  if (end - start > 1 && last.split("\n").length <= 3 && last.length <= 120) end -= 1;

  return {
    greeting: paragraphs.slice(0, start).join("\n\n"),
    middle: paragraphs.slice(start, end).join("\n\n"),
    signoff: paragraphs.slice(end).join("\n\n"),
  };
}

function joinParts({ greeting, middle, signoff }: TemplateParts) {
  return [greeting, middle.trim(), signoff].filter(Boolean).join("\n\n");
}

const tokensIn = (text: string) =>
  new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]));

const urlsIn = (text: string) =>
  [...text.matchAll(/https?:\/\/[^\s<>()"']+/g)].map((match) => match[0]).sort();

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const KNOWN_TOKENS = new Set(TEMPLATE_VARIABLES.map(({ token }) => token.slice(2, -2)));

/** Why a variation is unusable, or null when it can go out. */
function rejectVariant(
  original: { subject: string; middle: string; body: string },
  variant: { subject: string; middle: string; body: string },
): string | null {
  if (!variant.subject.trim() || !variant.middle.trim()) return "empty";
  if (variant.subject.length > 80) return "subject too long";

  const allowed = tokensIn(original.middle);
  const used = tokensIn(variant.middle);
  for (const token of allowed) if (!used.has(token)) return `dropped {{${token}}}`;
  for (const token of used) if (!allowed.has(token)) return `added {{${token}}}`;
  for (const token of tokensIn(variant.subject)) {
    if (!KNOWN_TOKENS.has(token)) return `unknown {{${token}}}`;
  }

  if (urlsIn(variant.middle).join(" ") !== urlsIn(original.middle).join(" ")) {
    return "changed the links";
  }

  if (wordCount(variant.middle) > wordCount(original.middle) * 1.5 + 20) return "too long";

  // Only new problems count; the template author already saw their own warnings.
  const known = new Set(checkContent(original.subject, original.body).map((w) => w.message));
  const added = checkContent(variant.subject, variant.body).filter(
    (warning) => warning.level === "warn" && !known.has(warning.message),
  );
  if (added.length > 0) return added[0].message;

  return null;
}

const INSTRUCTIONS = `You rewrite short B2B sales emails into natural alternative versions.

You get a subject line and the message part of a plain-text email (greeting and sign-off are handled separately — never add either).
Write each version as if a different, careful person wrote the same email:
- Keep the same meaning, offer, single call to action, tone and roughly the same length.
- Vary wording and sentence structure; each version must read differently from the original and from the others.
- Copy every {{placeholder}} exactly as written (double curly braces, same name) and use each one that appears in the message. Do not invent placeholders.
- Copy every URL exactly. Do not add links, prices, numbers, names, claims or promises that are not in the original.
- Plain text only: no markdown, no HTML, no emojis, no ALL CAPS words, at most one "?" or "!" in the subject.
- Subjects stay under 60 characters and must not look like marketing.
- Avoid these spam-trigger phrases: ${SPAM_TERMS.join(", ")}.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    variations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject: { type: "string" },
          message: { type: "string" },
        },
        required: ["subject", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["variations"],
  additionalProperties: false,
} as const;

type OpenAIResponse = {
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
};

async function askOpenAI(input: string): Promise<{ subject: string; message: string }[]> {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      instructions: INSTRUCTIONS,
      input,
      text: {
        format: {
          type: "json_schema",
          name: "email_variations",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => ({}))) as OpenAIResponse;

  if (!response.ok) {
    throw new Error(`OpenAI: ${data.error?.message ?? `request failed (${response.status})`}`);
  }
  if (data.status === "incomplete") {
    throw new Error(`OpenAI stopped early (${data.incomplete_details?.reason ?? "incomplete"}).`);
  }

  const content = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);

  const refusal = content.find((part) => part.type === "refusal");
  if (refusal) throw new Error(`OpenAI declined: ${refusal.refusal ?? "no reason given"}`);

  const text = content.find((part) => part.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no text.");

  const parsed = JSON.parse(text) as { variations?: { subject: string; message: string }[] };
  return parsed.variations ?? [];
}

export type GeneratedVariants = {
  variants: { subject: string; body: string }[];
  /** Why each discarded variation failed the checks. */
  rejected: string[];
};

/** Asks the model for `count` rewordings of a template and keeps the valid ones. */
export async function generateVariants(
  template: { subject: string; body: string },
  count: number,
  avoid: { subject: string; body: string }[] = [],
): Promise<GeneratedVariants> {
  const parts = splitTemplate(template.body);
  const original = { subject: template.subject, middle: parts.middle, body: template.body };

  const request = [
    `Write ${count} versions of this email.`,
    `Subject: ${template.subject}`,
    `Message:\n${parts.middle}`,
    avoid.length > 0
      ? `These subjects are already in use, so do not repeat them:\n${avoid.map((v) => `- ${v.subject}`).join("\n")}`
      : "",
  ];

  const raw = await askOpenAI(request.filter(Boolean).join("\n\n"));

  const seen = new Set(
    [template, ...avoid].map((existing) => `${existing.subject}\n${existing.body}`.toLowerCase()),
  );
  const variants: GeneratedVariants["variants"] = [];
  const rejected: string[] = [];

  for (const item of raw.slice(0, count)) {
    const subject = item.subject.trim().replace(/\s+/g, " ");
    const middle = item.message.trim();
    const body = joinParts({ ...parts, middle });

    const reason = rejectVariant(original, { subject, middle, body });
    const key = `${subject}\n${body}`.toLowerCase();

    if (reason) rejected.push(reason);
    else if (seen.has(key)) rejected.push("duplicate");
    else {
      seen.add(key);
      variants.push({ subject, body });
    }
  }

  return { variants, rejected };
}
