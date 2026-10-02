"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { aiConfigured, generateVariants, MAX_ACTIVE_VARIANTS } from "@/lib/ai-variants";
import { prisma } from "@/lib/prisma";

import type { ActionResult } from "./contacts";

/**
 * Writes AI variations of a campaign's template. They start active, so the
 * sender picks them up on its next batch; edit or pause any that read wrong.
 */
export async function generateCampaignVariants(
  campaignId: string,
  count = 5,
): Promise<{ ok: true; created: number; rejected: number } | { ok: false; error: string }> {
  await requireUser();

  if (!aiConfigured()) {
    return { ok: false, error: "Set OPENAI_API_KEY to turn on AI variations." };
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: { select: { subject: true, body: true } },
      variants: { where: { isActive: true }, select: { subject: true, body: true } },
    },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (campaign.status === "COMPLETED") {
    return { ok: false, error: "This campaign has finished sending." };
  }

  const room = MAX_ACTIVE_VARIANTS - campaign.variants.length;
  if (room <= 0) {
    return {
      ok: false,
      error: `${MAX_ACTIVE_VARIANTS} variations are already active — pause or delete some first.`,
    };
  }

  let result;
  try {
    result = await generateVariants(
      campaign.template,
      Math.min(Math.max(1, count), room),
      campaign.variants,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach OpenAI",
    };
  }

  if (result.variants.length === 0) {
    return {
      ok: false,
      error: `None of the variations passed the checks (${result.rejected.join(", ") || "empty reply"}). Try again.`,
    };
  }

  await prisma.campaignVariant.createMany({
    data: result.variants.map((variant) => ({ campaignId, ...variant })),
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, created: result.variants.length, rejected: result.rejected.length };
}

const variantSchema = z.object({
  subject: z.string().trim().min(1, "Write a subject").max(150),
  body: z.string().trim().min(1, "Write the email").max(5000),
});

export async function updateCampaignVariant(
  id: string,
  input: z.input<typeof variantSchema>,
): Promise<ActionResult> {
  await requireUser();

  const parsed = variantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid variation" };
  }

  const variant = await prisma.campaignVariant.update({
    where: { id },
    data: parsed.data,
    select: { campaignId: true },
  });

  revalidatePath(`/campaigns/${variant.campaignId}`);
  return { ok: true };
}

export async function setCampaignVariantActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireUser();

  if (isActive) {
    const current = await prisma.campaignVariant.findUnique({
      where: { id },
      select: { campaignId: true },
    });
    if (!current) return { ok: false, error: "Variation not found" };

    const active = await prisma.campaignVariant.count({
      where: { campaignId: current.campaignId, isActive: true, id: { not: id } },
    });
    if (active >= MAX_ACTIVE_VARIANTS) {
      return { ok: false, error: `At most ${MAX_ACTIVE_VARIANTS} variations can be active.` };
    }
  }

  const variant = await prisma.campaignVariant.update({
    where: { id },
    data: { isActive },
    select: { campaignId: true },
  });

  revalidatePath(`/campaigns/${variant.campaignId}`);
  return { ok: true };
}

export async function deleteCampaignVariant(id: string): Promise<ActionResult> {
  await requireUser();

  const variant = await prisma.campaignVariant.delete({
    where: { id },
    select: { campaignId: true },
  });

  revalidatePath(`/campaigns/${variant.campaignId}`);
  return { ok: true };
}
