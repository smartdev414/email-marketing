"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";

import type { ActionResult } from "./contacts";

const templateSchema = z.object({
  name: z.string().trim().min(2, "Give the template a name").max(120),
  subject: z.string().trim().min(2, "Subject line is required").max(200),
  body: z.string().trim().min(10, "Write the email body"),
  description: z.string().trim().max(300).optional(),
});

export type TemplateInput = z.input<typeof templateSchema>;

export async function createTemplate(input: TemplateInput): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template" };
  }

  await prisma.template.create({
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      description: parsed.data.description || null,
      createdById: user.id,
    },
  });

  revalidatePath("/templates");
  return { ok: true };
}

export async function updateTemplate(
  id: string,
  input: TemplateInput,
): Promise<ActionResult> {
  await requireUser();

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template" };
  }

  await prisma.template.update({
    where: { id },
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      description: parsed.data.description || null,
    },
  });

  revalidatePath("/templates");
  return { ok: true };
}

export async function duplicateTemplate(id: string): Promise<ActionResult> {
  const user = await requireUser();

  const source = await prisma.template.findUnique({ where: { id } });
  if (!source) return { ok: false, error: "Template not found" };

  await prisma.template.create({
    data: {
      name: `${source.name} (copy)`,
      subject: source.subject,
      body: source.body,
      description: source.description,
      createdById: user.id,
    },
  });

  revalidatePath("/templates");
  return { ok: true };
}

export async function setTemplateArchived(
  id: string,
  isArchived: boolean,
): Promise<ActionResult> {
  await requireUser();

  await prisma.template.update({ where: { id }, data: { isArchived } });

  revalidatePath("/templates");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  await requireUser();

  const inUse = await prisma.campaign.count({ where: { templateId: id } });
  if (inUse > 0) {
    return {
      ok: false,
      error: "This template is used by a campaign — archive it instead.",
    };
  }

  const inAutomation = await prisma.automation.count({ where: { templateId: id } });
  if (inAutomation > 0) {
    return { ok: false, error: "This template is used by an automation." };
  }

  await prisma.template.delete({ where: { id } });

  revalidatePath("/templates");
  return { ok: true };
}
