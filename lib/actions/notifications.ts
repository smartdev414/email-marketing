"use server";

import { z } from "zod";

import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";

import type { ActionResult } from "./contacts";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  createdAt: string;
};

/** Latest notifications for the header bell, plus the unread count. */
export async function getNotifications(): Promise<{
  items: NotificationItem[];
  unread: number;
}> {
  const user = await requireUser();

  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      url: row.url,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Stores this browser's Web Push subscription so the sender can reach it. */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The browser sent an invalid subscription." };

  const { endpoint, keys } = parsed.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const user = await requireUser();

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return { ok: true };
}
