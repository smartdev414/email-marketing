import webpush from "web-push";

import type { NotificationType } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { startOfSendDay } from "@/lib/send-window";

/**
 * Notifications raised by the background sender. Each one is stored (for the
 * header bell) and pushed to every browser the user enabled desktop
 * notifications in. Deliberately not a `"use server"` module.
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@example.com";

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/** Today's date in the sending timezone, for "once per day" dedupe keys. */
export function sendDayKey(date = new Date()) {
  return startOfSendDay(date).toISOString();
}

type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
  /** Same key twice means the same event: only the first is kept. */
  dedupeKey: string;
};

/** Records a notification once and pushes it to the desktop. Never throws. */
export async function notify(input: NotifyInput) {
  try {
    const created = await prisma.notification.createMany({
      data: [input],
      skipDuplicates: true,
    });
    if (created.count === 0) return;

    await pushToUser(input.userId, {
      title: input.title,
      body: input.body,
      url: input.url ?? "/dashboard",
      tag: input.dedupeKey,
    });
  } catch (error) {
    console.error("Could not record notification", error);
  }
}

async function pushToUser(
  userId: string,
  payload: { title: string; body: string; url: string; tag: string },
) {
  if (!pushConfigured) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
        );
      } catch (error) {
        // 404/410: the browser dropped this subscription, so forget it.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: subscription.id } })
            .catch(() => undefined);
        } else {
          console.error("Desktop notification failed", error);
        }
      }
    }),
  );
}
