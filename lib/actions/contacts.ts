"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { REJECTION_LABELS, screenAddress } from "@/lib/deliverability";
import { isSuppressed, suppress } from "@/lib/suppression";
import type { ContactStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: true } | { ok: false; error: string };

const contactSchema = z.object({
  email: z.email("Enter a valid email address"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  company: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  status: z
    .enum(["ACTIVE", "REPLIED", "BOUNCED", "UNSUBSCRIBED", "DO_NOT_CONTACT"])
    .default("ACTIVE"),
  notes: z.string().trim().max(2000).optional(),
});

export type ContactInput = z.input<typeof contactSchema>;

function toData(values: z.output<typeof contactSchema>) {
  return {
    email: values.email.toLowerCase(),
    firstName: values.firstName || null,
    lastName: values.lastName || null,
    company: values.company || null,
    jobTitle: values.jobTitle || null,
    phone: values.phone || null,
    country: values.country || null,
    status: values.status as ContactStatus,
    notes: values.notes || null,
  };
}

export async function createContact(input: ContactInput): Promise<ActionResult> {
  await requireUser();

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid contact" };
  }

  const rejection = screenAddress(parsed.data.email);
  if (rejection) {
    return { ok: false, error: `Cannot add this address — ${REJECTION_LABELS[rejection]}` };
  }

  if (await isSuppressed(parsed.data.email)) {
    return { ok: false, error: `Cannot add this address — ${REJECTION_LABELS.suppressed}` };
  }

  const existing = await prisma.contact.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true },
  });

  if (existing) {
    return { ok: false, error: "A contact with that email already exists" };
  }

  await prisma.contact.create({
    data: { ...toData(parsed.data), source: "manual" },
  });

  revalidatePath("/contacts");
  return { ok: true };
}

export async function updateContact(id: string, input: ContactInput): Promise<ActionResult> {
  await requireUser();

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid contact" };
  }

  const clash = await prisma.contact.findFirst({
    where: { email: parsed.data.email.toLowerCase(), id: { not: id } },
    select: { id: true },
  });

  if (clash) {
    return { ok: false, error: "Another contact already uses that email" };
  }

  await prisma.contact.update({ where: { id }, data: toData(parsed.data) });

  revalidatePath("/contacts");
  return { ok: true };
}

export async function deleteContacts(ids: string[]): Promise<ActionResult> {
  await requireUser();

  if (ids.length === 0) return { ok: false, error: "Nothing selected" };

  await prisma.contact.deleteMany({ where: { id: { in: ids } } });

  revalidatePath("/contacts");
  return { ok: true };
}

export async function setContactStatus(
  ids: string[],
  status: ContactStatus,
): Promise<ActionResult> {
  await requireUser();

  if (ids.length === 0) return { ok: false, error: "Nothing selected" };

  await prisma.contact.updateMany({ where: { id: { in: ids } }, data: { status } });

  revalidatePath("/contacts");
  return { ok: true };
}

/** Marks a contact unsubscribed and blocks them permanently. */
export async function unsubscribeByToken(
  token: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { trackingToken: token },
    include: { contact: { select: { id: true, email: true } } },
  });

  if (!recipient) return { ok: false, error: "This link is no longer valid." };

  await suppress(recipient.contact.email, "Unsubscribed");

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: recipient.contact.id },
      data: { status: "UNSUBSCRIBED" },
    }),
    prisma.emailEvent.create({
      data: { recipientId: recipient.id, type: "UNSUBSCRIBE" },
    }),
    // Pull them out of anything still queued.
    prisma.campaignRecipient.updateMany({
      where: { contactId: recipient.contact.id, status: "PENDING" },
      data: { status: "FAILED", error: "Unsubscribed before send" },
    }),
  ]);

  return { ok: true, email: recipient.contact.email };
}
