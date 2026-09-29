"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";

import type { ActionResult } from "./contacts";

/** Mailboxes can only be changed by the person who connected them, or an admin. */
async function findOwnedMailbox(id: string) {
  const user = await requireUser();

  const mailbox = await prisma.emailAccount.findUnique({
    where: { id },
    select: { id: true, userId: true },
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

  await prisma.emailAccount.update({ where: { id }, data: { isActive } });

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
