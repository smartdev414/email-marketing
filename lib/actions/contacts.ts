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

const HEADER_ALIASES: Record<string, keyof z.input<typeof contactSchema>> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  firstname: "firstName",
  "first name": "firstName",
  "first_name": "firstName",
  lastname: "lastName",
  "last name": "lastName",
  "last_name": "lastName",
  company: "company",
  organisation: "company",
  organization: "company",
  title: "jobTitle",
  jobtitle: "jobTitle",
  "job title": "jobTitle",
  phone: "phone",
  "phone number": "phone",
  country: "country",
  notes: "notes",
};

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export type ImportSummary = {
  ok: true;
  created: number;
  updated: number;
  skipped: number;
  /** Counts by why a row was rejected, so the UI can explain the skips. */
  rejected: Partial<Record<"invalid" | "role" | "disposable" | "suppressed", number>>;
};

/** Imports a pasted or uploaded CSV. First row must be a header row. */
export async function importContactsCsv(
  csv: string,
): Promise<ImportSummary | { ok: false; error: string }> {
  await requireUser();

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { ok: false, error: "CSV needs a header row and at least one contact" };
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const emailIndex = headers.findIndex((header) => HEADER_ALIASES[header] === "email");

  if (emailIndex === -1) {
    return { ok: false, error: "CSV must contain an 'email' column" };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const rejected: ImportSummary["rejected"] = {};

  function reject(reason: keyof ImportSummary["rejected"]) {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
    skipped += 1;
  }

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const raw: Record<string, string> = {};

    headers.forEach((header, index) => {
      const field = HEADER_ALIASES[header];
      if (field && cells[index]) raw[field] = cells[index];
    });

    const parsed = contactSchema.safeParse(raw);
    if (!parsed.success) {
      reject("invalid");
      continue;
    }

    // List hygiene up front: never let a bad address into the database.
    const rejection = screenAddress(parsed.data.email);
    if (rejection) {
      reject(rejection);
      continue;
    }

    if (await isSuppressed(parsed.data.email)) {
      reject("suppressed");
      continue;
    }

    const data = toData(parsed.data);
    const existing = await prisma.contact.findUnique({
      where: { email: data.email },
      select: { id: true },
    });

    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.contact.create({ data: { ...data, source: "csv" } });
      created += 1;
    }
  }

  revalidatePath("/contacts");
  return { ok: true, created, updated, skipped, rejected };
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
