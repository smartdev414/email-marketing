-- Optional indexes for the hl_contacts warehouse.
--
-- Run these AFTER loading the dump, never before: indexes make a 50M-row bulk
-- insert several times slower. CONCURRENTLY keeps the table readable while they
-- build, but each statement must run on its own (no transaction block), so use:
--
--   psql "$DATABASE_URL" -f prisma/sql/hl_contacts_indexes.sql
--
-- or: npm run db:index-warehouse

CREATE INDEX CONCURRENTLY IF NOT EXISTS hl_contacts_email_norm_idx
  ON "hl_contacts" (lower("email"));

CREATE INDEX CONCURRENTLY IF NOT EXISTS hl_contacts_business_id_idx
  ON "hl_contacts" ("business_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS hl_contacts_tenant_id_idx
  ON "hl_contacts" ("tenant_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS hl_contacts_createdat_idx
  ON "hl_contacts" ("createdat" DESC);

-- Partial index: the importer only ever looks at non-spam rows with an email.
CREATE INDEX CONCURRENTLY IF NOT EXISTS hl_contacts_sendable_idx
  ON "hl_contacts" ("id")
  WHERE "email" IS NOT NULL AND "email" <> '' AND ("is_spam" IS NULL OR "is_spam" = false);

ANALYZE "hl_contacts";
