-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "emailAccountId" TEXT;

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "email" TEXT NOT NULL,
    "fromName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" INTEGER,
    "scope" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimit" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CampaignSenders" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CampaignSenders_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "EmailAccount_userId_idx" ON "EmailAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_userId_email_key" ON "EmailAccount"("userId", "email");

-- CreateIndex
CREATE INDEX "_CampaignSenders_B_index" ON "_CampaignSenders"("B");

-- CreateIndex
CREATE INDEX "CampaignRecipient_emailAccountId_sentAt_idx" ON "CampaignRecipient"("emailAccountId", "sentAt");

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CampaignSenders" ADD CONSTRAINT "_CampaignSenders_A_fkey" FOREIGN KEY ("A") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CampaignSenders" ADD CONSTRAINT "_CampaignSenders_B_fkey" FOREIGN KEY ("B") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: every existing Google sign-in that can send becomes a connected
-- mailbox, so campaigns created before multi-mailbox support keep sending.
-- ---------------------------------------------------------------------------
INSERT INTO "EmailAccount" ("id", "userId", "provider", "email", "accessToken", "refreshToken", "expiresAt", "scope", "createdAt", "updatedAt")
SELECT
    'ea_' || a."id",
    a."userId",
    'google',
    lower(u."email"),
    a."access_token",
    a."refresh_token",
    a."expires_at",
    a."scope",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Account" a
JOIN "User" u ON u."id" = a."userId"
WHERE a."provider" = 'google'
  AND a."access_token" IS NOT NULL
ON CONFLICT ("userId", "email") DO NOTHING;

-- Existing campaigns send from their creator's mailbox.
INSERT INTO "_CampaignSenders" ("A", "B")
SELECT c."id", e."id"
FROM "Campaign" c
JOIN "EmailAccount" e ON e."userId" = c."fromUserId"
ON CONFLICT DO NOTHING;

-- Already-sent mail lives in the assignee's mailbox; threads are per mailbox.
UPDATE "CampaignRecipient" r
SET "emailAccountId" = e."id"
FROM "EmailAccount" e
WHERE r."emailAccountId" IS NULL
  AND r."assignedToId" = e."userId";
