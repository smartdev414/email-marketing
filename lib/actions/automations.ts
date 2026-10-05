"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { screenAddress, sendDelay, sleep } from "@/lib/deliverability";
import { isSuppressed } from "@/lib/suppression";
import { mailboxSenderName, sendEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { buildVariables, renderTemplate } from "@/lib/template";
import { oneClickUnsubscribeUrl, textToHtml, withTracking } from "@/lib/tracking";

import type { ActionResult } from "./contacts";

const automationSchema = z.object({
  name: z.string().trim().min(2, "Give the automation a name").max(120),
  description: z.string().trim().max(300).optional(),
  trigger: z.enum(["NO_REPLY_AFTER_DAYS", "OPENED_NO_REPLY", "AFTER_SEND"]),
  delayDays: z.number().int().min(1).max(60),
  templateId: z.string().min(1, "Pick a follow-up template"),
  isActive: z.boolean().default(false),
});

export type AutomationInput = z.input<typeof automationSchema>;

export async function createAutomation(input: AutomationInput): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid automation" };
  }

  await prisma.automation.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      trigger: parsed.data.trigger,
      delayDays: parsed.data.delayDays,
      templateId: parsed.data.templateId,
      isActive: parsed.data.isActive,
      createdById: user.id,
    },
  });

  revalidatePath("/automations");
  return { ok: true };
}

export async function updateAutomation(
  id: string,
  input: AutomationInput,
): Promise<ActionResult> {
  await requireUser();

  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid automation" };
  }

  await prisma.automation.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      trigger: parsed.data.trigger,
      delayDays: parsed.data.delayDays,
      templateId: parsed.data.templateId,
      isActive: parsed.data.isActive,
    },
  });

  revalidatePath("/automations");
  return { ok: true };
}

export async function setAutomationActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireUser();

  await prisma.automation.update({ where: { id }, data: { isActive } });

  revalidatePath("/automations");
  return { ok: true };
}

export async function deleteAutomation(id: string): Promise<ActionResult> {
  await requireUser();

  await prisma.automation.delete({ where: { id } });

  revalidatePath("/automations");
  return { ok: true };
}

/**
 * Finds recipients that match an active automation's trigger and sends the
 * follow-up in the same email thread. Shared by the "Run now" button and the
 * cron endpoint, so a rule behaves identically either way.
 */
export async function runAutomations(): Promise<
  { ok: true; sent: number; skipped: number } | { ok: false; error: string }
> {
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
    include: { template: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const automation of automations) {
    const cutoff = new Date(Date.now() - automation.delayDays * 24 * 60 * 60 * 1000);

    const baseWhere = {
      sentAt: { lte: cutoff },
      repliedAt: null,
      // Follow-ups must leave from the mailbox that owns the thread.
      emailAccountId: { not: null },
      contact: { status: "ACTIVE" as const },
      // One follow-up per rule per recipient.
      runs: { none: { automationId: automation.id } },
    };

    const where =
      automation.trigger === "OPENED_NO_REPLY"
        ? { ...baseWhere, firstOpenedAt: { not: null } }
        : baseWhere;

    const matches = await prisma.campaignRecipient.findMany({
      where,
      include: { contact: true, assignedTo: true, campaign: true, emailAccount: true },
      take: 100,
    });

    for (const [index, recipient] of matches.entries()) {
      const mailbox = recipient.emailAccount;
      if (!mailbox || !mailbox.isActive) {
        skipped += 1;
        continue;
      }

      // Same guardrails as a campaign send.
      if (screenAddress(recipient.contact.email) || (await isSuppressed(recipient.contact.email))) {
        await prisma.automationRun.create({
          data: {
            automationId: automation.id,
            recipientId: recipient.id,
            status: "SKIPPED",
            error: "Address failed deliverability screening",
          },
        });
        skipped += 1;
        continue;
      }

      if (index > 0) await sleep(sendDelay());

      const senderName = await mailboxSenderName(mailbox);
      const variables = buildVariables(recipient.contact, senderName);
      const subject = recipient.subject
        ? `Re: ${recipient.subject}`
        : renderTemplate(automation.template.subject, variables);
      const html = withTracking(
        renderTemplate(textToHtml(automation.template.body), variables),
        recipient.trackingToken,
        { opens: recipient.campaign.trackOpens, clicks: recipient.campaign.trackClicks },
      );

      try {
        await sendEmail({
          emailAccountId: mailbox.id,
          fromName: senderName,
          to: recipient.contact.email,
          subject,
          html,
          threadId: recipient.gmailThreadId,
          inReplyTo: recipient.gmailMessageId,
          unsubscribeUrl: oneClickUnsubscribeUrl(recipient.trackingToken),
        });

        await prisma.automationRun.create({
          data: {
            automationId: automation.id,
            recipientId: recipient.id,
            status: "SENT",
          },
        });

        sent += 1;
      } catch (error) {
        await prisma.automationRun.create({
          data: {
            automationId: automation.id,
            recipientId: recipient.id,
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
        skipped += 1;
      }
    }

    await prisma.automation.update({
      where: { id: automation.id },
      data: { lastRunAt: new Date() },
    });
  }

  revalidatePath("/automations");
  return { ok: true, sent, skipped };
}

export async function runAutomationsNow() {
  await requireUser();
  return runAutomations();
}
