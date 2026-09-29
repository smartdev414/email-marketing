"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { screenAddress } from "@/lib/deliverability";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * `hl_contacts` is the raw GoHighLevel warehouse — tens of millions of rows,
 * loaded straight from the SQL dump and never written to by the app. Every
 * sendable row is copied into `Contact` (the working set) and campaigns sample
 * from there.
 *
 * Everything here is written for warehouse scale — no `COUNT(*)`, no
 * `ORDER BY random()`, no `OFFSET`; the import walks the primary key.
 */

/** Rows read from the warehouse per query. Walks the primary key, so each is an index range scan. */
const CHUNK_SIZE = 5_000;
/** Rows per INSERT — keeps the bind-parameter count well under Postgres' 65k limit. */
const INSERT_SIZE = 2_000;
/** Wall-clock budget per call. The dialog keeps calling until the warehouse is drained. */
const TIME_BUDGET_MS = 20_000;

const importSchema = z.object({
  /** Resume after this `hl_contacts.id` (stringified bigint). Omit to start from the beginning. */
  cursor: z.string().regex(/^\d+$/).optional(),
  /** Stop after importing this many in this call. Omit to pull as many as the time budget allows. */
  limit: z.number().int().min(1).optional(),
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

export type WarehouseImportResult =
  | {
      ok: true;
      scanned: number;
      imported: number;
      duplicates: number;
      rejected: number;
      /** Pass back as `cursor` to continue. */
      cursor: string;
      /** True once the end of `hl_contacts` has been reached. */
      done: boolean;
    }
  | { ok: false; error: string };

/**
 * Pulls every eligible warehouse row into `Contact`, walking `hl_contacts` in
 * primary-key order. One call works for about `TIME_BUDGET_MS` and returns a
 * cursor; call again with it until `done` is true.
 */
export async function importFromWarehouse(
  input: WarehouseImportInput = {},
): Promise<WarehouseImportResult> {
  await requireUser();

  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }

  const { limit } = parsed.data;
  let cursor = BigInt(parsed.data.cursor ?? 0);
  const startedAt = Date.now();

  let scanned = 0;
  let imported = 0;
  let duplicates = 0;
  let rejected = 0;
  let done = false;

  while (Date.now() - startedAt < TIME_BUDGET_MS && (limit === undefined || imported < limit)) {
    const rows = await prisma.$queryRaw<WarehouseRow[]>`
      SELECT h."id", h."email", h."full_name", h."phone",
             h."city", h."state", h."country", h."campaign", h."lead_source"
      FROM "hl_contacts" h
      WHERE h."id" > ${cursor}
        AND h."email" IS NOT NULL
        AND h."email" <> ''
        AND (h."is_spam" IS NULL OR h."is_spam" = false)
        -- Skip anything already pulled in.
        AND NOT EXISTS (SELECT 1 FROM "Contact" c WHERE c."sourceId" = h."id")
        -- Never re-import a blocked address.
        AND NOT EXISTS (
          SELECT 1 FROM "Suppression" s
          WHERE (s."type" = 'EMAIL' AND s."value" = lower(h."email"))
             OR (s."type" = 'DOMAIN' AND s."value" = split_part(lower(h."email"), '@', 2))
        )
      ORDER BY h."id"
      LIMIT ${CHUNK_SIZE}
    `;

    if (rows.length === 0) {
      done = true;
      break;
    }

    scanned += rows.length;

    const seen = new Set<string>();
    const candidates: Prisma.ContactCreateManyInput[] = [];

    for (const row of rows) {
      if (limit !== undefined && imported + candidates.length >= limit) break;
      cursor = row.id;

      const email = row.email!.trim().toLowerCase();

      if (seen.has(email)) {
        duplicates += 1;
        continue;
      }
      seen.add(email);

      if (screenAddress(email)) {
        rejected += 1;
        continue;
      }

      candidates.push({
        email,
        ...splitName(row.full_name, email),
        phone: row.phone,
        country: row.country,
        company: null,
        notes: [row.city, row.state].filter(Boolean).join(", ") || null,
        source: row.lead_source ?? row.campaign ?? "hl_contacts",
        sourceId: row.id,
        status: "ACTIVE",
      });
    }

    for (let index = 0; index < candidates.length; index += INSERT_SIZE) {
      const slice = candidates.slice(index, index + INSERT_SIZE);
      // `skipDuplicates` leans on Contact.email being unique.
      const created = await prisma.contact.createMany({ data: slice, skipDuplicates: true });
      imported += created.count;
      duplicates += slice.length - created.count;
    }

    // A short page means the end of the table, unless the limit cut it off early.
    if (rows.length < CHUNK_SIZE && cursor === rows[rows.length - 1].id) {
      done = true;
      break;
    }
  }

  if (imported > 0) {
    revalidatePath("/contacts");
    revalidatePath("/dashboard");
  }

  return {
    ok: true,
    scanned,
    imported,
    duplicates,
    rejected,
    cursor: cursor.toString(),
    done,
  };
}
