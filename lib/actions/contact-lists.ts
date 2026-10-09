"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { IMPORT_BATCH_SIZE, IMPORT_FIELDS, type ImportField } from "@/lib/contact-import";
import { screenAddress, type AddressRejection } from "@/lib/deliverability";
import { prisma } from "@/lib/prisma";
import { suppressedAmong } from "@/lib/suppression";

import type { ActionResult } from "./contacts";

/** Lists for pickers, with how many contacts each holds. */
export async function getContactLists() {
  await requireUser();

  const lists = await prisma.contactList.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  return lists.map((list) => ({ id: list.id, name: list.name, size: list._count.members }));
}

const listNameSchema = z.string().trim().min(2, "Give the list a name").max(80);

/** Finds a list by name (any case) or creates it, so re-importing adds to it. */
export async function findOrCreateContactList(
  name: string,
): Promise<{ ok: true; id: string; name: string; existed: boolean } | { ok: false; error: string }> {
  const user = await requireUser();

  const parsed = listNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };

  const existing = await prisma.contactList.findFirst({
    where: { name: { equals: parsed.data, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (existing) return { ok: true, ...existing, existed: true };

  const list = await prisma.contactList.create({
    data: { name: parsed.data, createdById: user.id },
    select: { id: true, name: true },
  });
  return { ok: true, ...list, existed: false };
}

const cell = z.string().trim().max(2000).optional();

const rowSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  firstName: cell,
  lastName: cell,
  company: cell,
  jobTitle: cell,
  phone: cell,
  country: cell,
  notes: cell,
});

/** Column limits, matching the contact form. */
const MAX_LENGTH: Record<Exclude<ImportField, "email">, number> = {
  firstName: 80,
  lastName: 80,
  company: 120,
  jobTitle: 120,
  phone: 40,
  country: 80,
  notes: 2000,
};

const OPTIONAL_FIELDS = IMPORT_FIELDS.map((field) => field.key).filter(
  (key): key is Exclude<ImportField, "email"> => key !== "email",
);

export type ImportBatchResult = {
  ok: true;
  /** New contacts added to the database. */
  created: number;
  /** Existing contacts that had empty fields filled from the file. */
  updated: number;
  /** Existing contacts added to the list unchanged. */
  unchanged: number;
  /** Repeated emails inside the file. */
  duplicates: number;
  rejected: Partial<Record<AddressRejection, number>>;
};

/**
 * Imports one batch of parsed rows into a list. New emails become contacts;
 * contacts that already exist keep everything they have and only get empty
 * fields filled. Every accepted contact joins the list. Uses a handful of
 * queries per batch, not per row.
 */
export async function importContactsBatch(
  listId: string,
  input: unknown[],
): Promise<ImportBatchResult | { ok: false; error: string }> {
  await requireUser();

  if (!Array.isArray(input) || input.length > IMPORT_BATCH_SIZE) {
    return { ok: false, error: `Send at most ${IMPORT_BATCH_SIZE} rows at a time.` };
  }
  const list = await prisma.contactList.findUnique({ where: { id: listId }, select: { id: true } });
  if (!list) return { ok: false, error: "That list no longer exists." };

  const rejected: ImportBatchResult["rejected"] = {};
  const reject = (reason: AddressRejection) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  // Validate, trim to column limits, screen, and de-duplicate within the batch.
  const rows = new Map<string, z.output<typeof rowSchema>>();
  let duplicates = 0;
  for (const raw of input) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      reject("invalid");
      continue;
    }
    const row = parsed.data;
    for (const key of OPTIONAL_FIELDS) {
      if (row[key]) row[key] = row[key].slice(0, MAX_LENGTH[key]);
    }
    const rejection = screenAddress(row.email);
    if (rejection) {
      reject(rejection);
      continue;
    }
    if (rows.has(row.email)) {
      duplicates += 1;
      continue;
    }
    rows.set(row.email, row);
  }

  const blocked = await suppressedAmong([...rows.keys()]);
  for (const email of blocked) {
    rows.delete(email);
    reject("suppressed");
  }

  const emails = [...rows.keys()];
  const existing = await prisma.contact.findMany({
    where: { email: { in: emails } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      jobTitle: true,
      phone: true,
      country: true,
      notes: true,
    },
  });
  const existingByEmail = new Map(existing.map((contact) => [contact.email, contact]));

  const fresh = emails.filter((email) => !existingByEmail.has(email));
  const created = fresh.length
    ? (
        await prisma.contact.createMany({
          data: fresh.map((email) => {
            const row = rows.get(email)!;
            return {
              email,
              firstName: row.firstName || null,
              lastName: row.lastName || null,
              company: row.company || null,
              jobTitle: row.jobTitle || null,
              phone: row.phone || null,
              country: row.country || null,
              notes: row.notes || null,
              source: "import",
            };
          }),
          // Another import may add the same address at the same moment.
          skipDuplicates: true,
        })
      ).count
    : 0;

  // Existing contacts: fill only what is empty; never touch status or history.
  const fills = existing.flatMap((contact) => {
    const row = rows.get(contact.email)!;
    const patch: Partial<Record<Exclude<ImportField, "email">, string>> = {};
    for (const key of OPTIONAL_FIELDS) {
      if (!contact[key] && row[key]) patch[key] = row[key];
    }
    return Object.keys(patch).length ? [{ id: contact.id, patch }] : [];
  });
  if (fills.length) {
    await prisma.$transaction(
      fills.map(({ id, patch }) => prisma.contact.update({ where: { id }, data: patch })),
    );
  }

  // Everyone accepted joins the list, new and existing alike.
  const members = await prisma.contact.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  if (members.length) {
    await prisma.contactListMember.createMany({
      data: members.map((member) => ({ listId, contactId: member.id })),
      skipDuplicates: true,
    });
  }

  return {
    ok: true,
    created,
    updated: fills.length,
    unchanged: existing.length - fills.length,
    duplicates,
    rejected,
  };
}

/** Called once after the last batch, so the pages refresh a single time. */
export async function finishContactImport(): Promise<void> {
  await requireUser();
  revalidatePath("/contacts");
  revalidatePath("/campaigns");
}

/** Deletes a list. Its contacts stay; campaigns that used it keep their audience. */
export async function deleteContactList(id: string): Promise<ActionResult> {
  await requireUser();

  await prisma.contactList.delete({ where: { id } }).catch(() => null);

  revalidatePath("/contacts");
  revalidatePath("/campaigns");
  return { ok: true };
}
