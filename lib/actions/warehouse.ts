"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { screenAddress } from "@/lib/deliverability";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * `hl_contacts` is the raw GoHighLevel warehouse — tens of millions of rows,
 * loaded straight from the SQL dump and never written to by the app. You do not
 * campaign to all of it: you draw a slice into `Contact` (the working set) and
 * campaigns sample from there.
 *
 * Everything here is written for warehouse scale — no `COUNT(*)`, no
 * `ORDER BY random()` over the whole table.
 */

const importSchema = z.object({
  /** How many contacts to pull into the working set. */
  limit: z.number().int().min(1).max(50_000),
  /** Match against `hl_contacts.tags` (substring, case-insensitive). */
  tag: z.string().trim().max(120).optional(),
  businessId: z.number().int().optional(),
  /** Tag every imported contact with this, so campaigns can target the batch. */
  label: z.string().trim().max(60).optional(),
});

export type WarehouseImportInput = z.input<typeof importSchema>;

/** Planner estimate — instant even on 50M rows, unlike COUNT(*). */
export async function getWarehouseStats() {
  await requireUser();

  const [estimate] = await prisma.$queryRaw<{ rows: bigint | null }[]>`
    SELECT GREATEST(reltuples, 0)::bigint AS rows
    FROM pg_class
    WHERE oid = 'public.hl_contacts'::regclass
  `;

  const imported = await prisma.contact.count({ where: { sourceId: { not: null } } });

  return {
    estimatedRows: Number(estimate?.rows ?? 0),
    imported,
  };
}

type WarehouseRow = {
  id: bigint;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  tags: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  campaign: string | null;
  lead_source: string | null;
};

/** Many dump rows carry the email address in `full_name`. */
function splitName(fullName: string | null, email: string) {
  const value = fullName?.trim() ?? "";
  if (!value || value.toLowerCase() === email.toLowerCase() || value.includes("@")) {
    return { firstName: null, lastName: null };
  }

  const parts = value.split(/\s+/);
  const titleCase = (part: string) => part.charAt(0).toUpperCase() + part.slice(1);

  return {
    firstName: titleCase(parts[0]),
    lastName: parts.length > 1 ? parts.slice(1).map(titleCase).join(" ") : null,
  };
}

function parseTags(tags: string | null) {
  if (!tags) return [];
  return [...new Set(tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export type WarehouseImportResult =
  | {
      ok: true;
      scanned: number;
      imported: number;
      duplicates: number;
      rejected: number;
    }
  | { ok: false; error: string };

export async function importFromWarehouse(
  input: WarehouseImportInput,
): Promise<WarehouseImportResult> {
  await requireUser();

  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }

  const { limit, tag, businessId, label } = parsed.data;

  // Pull extra rows because screening, suppression and dedupe all reject some.
  const oversample = Math.min(limit * 4, 200_000);

  const conditions = [
    Prisma.sql`h."email" IS NOT NULL`,
    Prisma.sql`h."email" <> ''`,
    Prisma.sql`(h."is_spam" IS NULL OR h."is_spam" = false)`,
    // Skip anything already pulled in.
    Prisma.sql`NOT EXISTS (SELECT 1 FROM "Contact" c WHERE c."sourceId" = h."id")`,
    // Never re-import a blocked address.
    Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "Suppression" s
      WHERE (s."type" = 'EMAIL' AND s."value" = lower(h."email"))
         OR (s."type" = 'DOMAIN' AND s."value" = split_part(lower(h."email"), '@', 2))
    )`,
  ];

  if (tag) conditions.push(Prisma.sql`h."tags" ILIKE ${`%${tag}%`}`);
  if (businessId !== undefined) conditions.push(Prisma.sql`h."business_id" = ${businessId}`);

  let rows: WarehouseRow[];

  if (tag || businessId !== undefined) {
    // A filter is present, so let Postgres scan and stop at the limit. Add the
    // optional indexes (prisma/sql/hl_contacts_indexes.sql) to make this fast.
    rows = await prisma.$queryRaw<WarehouseRow[]>`
      SELECT h."id", h."email", h."full_name", h."phone", h."tags",
             h."city", h."state", h."country", h."campaign", h."lead_source"
      FROM "hl_contacts" h
      WHERE ${Prisma.join(conditions, " AND ")}
      LIMIT ${oversample}
    `;
  } else {
    // No filter: sample random pages instead of ordering 50M rows at random.
    const { estimatedRows } = await getWarehouseStats();
    const percent =
      estimatedRows > 0
        ? Math.min(100, Math.max(0.001, (oversample / estimatedRows) * 100 * 3))
        : 100;

    rows = await prisma.$queryRaw<WarehouseRow[]>`
      SELECT h."id", h."email", h."full_name", h."phone", h."tags",
             h."city", h."state", h."country", h."campaign", h."lead_source"
      FROM "hl_contacts" h TABLESAMPLE SYSTEM (${Prisma.raw(percent.toFixed(6))})
      WHERE ${Prisma.join(conditions, " AND ")}
      LIMIT ${oversample}
    `;
  }

  const seen = new Set<string>();
  const candidates: Prisma.ContactCreateManyInput[] = [];
  let rejected = 0;

  for (const row of rows) {
    if (candidates.length >= limit) break;

    const email = row.email!.trim().toLowerCase();

    if (seen.has(email)) continue;
    seen.add(email);

    if (screenAddress(email)) {
      rejected += 1;
      continue;
    }

    const tags = parseTags(row.tags);
    if (label) tags.push(label.toLowerCase());

    candidates.push({
      email,
      ...splitName(row.full_name, email),
      phone: row.phone,
      country: row.country,
      company: null,
      notes: [row.city, row.state].filter(Boolean).join(", ") || null,
      tags: [...new Set(tags)],
      source: row.lead_source ?? row.campaign ?? "hl_contacts",
      sourceId: row.id,
      status: "ACTIVE",
    });
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        rows.length === 0
          ? "No warehouse rows matched. Check the tag filter, or load the dump first."
          : "Every sampled row was already imported or failed screening.",
    };
  }

  // `skipDuplicates` leans on Contact.email being unique.
  const created = await prisma.contact.createMany({
    data: candidates,
    skipDuplicates: true,
  });

  revalidatePath("/contacts");
  revalidatePath("/dashboard");

  return {
    ok: true,
    scanned: rows.length,
    imported: created.count,
    duplicates: candidates.length - created.count,
    rejected,
  };
}
