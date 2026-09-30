"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/auth";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

import type { ActionResult } from "./contacts";

const passwordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(200, "That password is too long"),
});

export type PasswordInput = z.input<typeof passwordSchema>;

/**
 * Sets or changes the signed-in user's password. Google-only users set one
 * without a current password; once set, changing it needs the old one.
 */
export async function changePassword(input: PasswordInput): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) return { ok: false, error: "Account not found" };

  if (record.passwordHash) {
    const valid = await verifyPassword(parsed.data.currentPassword ?? "", record.passwordHash);
    if (!valid) return { ok: false, error: "Current password is incorrect" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  revalidatePath("/settings");
  return { ok: true };
}
