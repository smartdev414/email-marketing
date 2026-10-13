"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { verifyImapLogin, verifySmtpLogin } from "@/lib/mail/smtp";
import {
  MailboxConnectionError,
  providerLabel,
  SEND_LIMIT_ERROR,
  SMTP_SCOPE,
} from "@/lib/mailbox";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-box";

import type { ActionResult } from "./contacts";

/** Mailboxes can only be changed by the person who connected them, or an admin. */
async function findOwnedMailbox(id: string) {
  const user = await requireUser();

  const mailbox = await prisma.emailAccount.findUnique({
    where: { id },
    select: { id: true, userId: true, lastError: true },
  });

  if (!mailbox) return null;
  if (mailbox.userId !== user.id && user.role !== "ADMIN") return null;
  return mailbox;
}

function refresh() {
  revalidatePath("/integrations");
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
}

const mailboxSchema = z.object({
  fromName: z.string().trim().max(80).optional(),
  /** Blank means "use DAILY_SEND_LIMIT". */
  dailyLimit: z.number().int().min(1).max(2000).nullable().optional(),
});

export type MailboxInput = z.input<typeof mailboxSchema>;

export async function updateMailbox(id: string, input: MailboxInput): Promise<ActionResult> {
  const mailbox = await findOwnedMailbox(id);
  if (!mailbox) return { ok: false, error: "Mailbox not found" };

  const parsed = mailboxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }

  await prisma.emailAccount.update({
    where: { id },
    data: {
      fromName: parsed.data.fromName || null,
      dailyLimit: parsed.data.dailyLimit ?? null,
    },
  });

  refresh();
  return { ok: true };
}

export async function setMailboxActive(id: string, isActive: boolean): Promise<ActionResult> {
  const mailbox = await findOwnedMailbox(id);
  if (!mailbox) return { ok: false, error: "Mailbox not found" };

  await prisma.emailAccount.update({
    where: { id },
    data: {
      isActive,
      // Switching back on is how a sending-limit pause ends.
      ...(isActive && mailbox.lastError === SEND_LIMIT_ERROR ? { lastError: null } : {}),
    },
  });

  refresh();
  return { ok: true };
}

const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a server name like mail.example.com");
const portSchema = z.number().int().min(1).max(65535);

const smtpMailboxSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter the mailbox password").max(500),
  fromName: z.string().trim().max(80).optional(),
  smtpHost: hostSchema,
  smtpPort: portSchema,
  imapHost: hostSchema,
  imapPort: portSchema,
});

export type SmtpMailboxInput = z.input<typeof smtpMailboxSchema>;

/** Socket errors say little on their own; name the server that failed. */
function smtpFailureMessage(error: unknown, host: string) {
  if (error instanceof MailboxConnectionError) {
    return "The mail server rejected the email or password. Use the same login as webmail.";
  }
  const code = (error as { code?: string })?.code ?? "";
  if (["ENOTFOUND", "EDNS"].includes(code)) {
    return `Could not find the server ${host}. Check the server name.`;
  }
  if (["ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(code)) {
    return `Could not connect to ${host}. Check the server name and port.`;
  }
  return error instanceof Error ? error.message : "Could not connect to the mail server.";
}

/**
 * Connects (or reconnects) a mailbox from any other provider over SMTP and
 * IMAP. The password is stored encrypted in `accessToken`.
 */
export async function connectSmtpMailbox(input: SmtpMailboxInput): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = smtpMailboxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }
  const { email, password, fromName, ...servers } = parsed.data;

  const existing = await prisma.emailAccount.findUnique({
    where: { userId_email: { userId: user.id, email } },
    select: { provider: true, fromName: true },
  });
  if (existing && existing.provider !== "smtp") {
    const label = providerLabel(existing);
    return { ok: false, error: `${email} is already connected through ${label}.` };
  }

  // Both logins are tried before saving, so a saved mailbox is known to work.
  const settings = { email, password, ...servers };
  try {
    await verifySmtpLogin(settings);
  } catch (error) {
    return { ok: false, error: smtpFailureMessage(error, servers.smtpHost) };
  }
  try {
    await verifyImapLogin(settings);
  } catch (error) {
    return { ok: false, error: smtpFailureMessage(error, servers.imapHost) };
  }

  const data = {
    ...servers,
    accessToken: encryptSecret(password),
    scope: SMTP_SCOPE,
    lastError: null,
    fromName: fromName || existing?.fromName || null,
  };

  await prisma.emailAccount.upsert({
    where: { userId_email: { userId: user.id, email } },
    update: { ...data, isActive: true },
    create: { ...data, userId: user.id, email, provider: "smtp" },
  });

  refresh();
  return { ok: true };
}

/**
 * Forgets the stored tokens but keeps the mailbox row, so reconnecting the same
 * address later picks its existing threads back up for replies and follow-ups.
 */
export async function disconnectMailbox(id: string): Promise<ActionResult> {
  const mailbox = await findOwnedMailbox(id);
  if (!mailbox) return { ok: false, error: "Mailbox not found" };

  await prisma.emailAccount.update({
    where: { id },
    data: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      isActive: false,
      lastError: null,
    },
  });

  refresh();
  return { ok: true };
}

/** Deletes a mailbox for good. Its sent history stays; its threads are orphaned. */
export async function removeMailbox(id: string): Promise<ActionResult> {
  const mailbox = await findOwnedMailbox(id);
  if (!mailbox) return { ok: false, error: "Mailbox not found" };

  await prisma.emailAccount.delete({ where: { id } });

  refresh();
  return { ok: true };
}
