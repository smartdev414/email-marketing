"use client";

import { formatDistanceToNow } from "date-fns";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removePushSubscription,
  savePushSubscription,
  type NotificationItem,
} from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const POLL_MS = 60_000;

type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

/** Web Push wants the VAPID key as raw bytes, not base64url text. */
function keyBytes(base64Url: string) {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function detectPush(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [push, setPush] = useState<PushState>("off");
  const [busy, startTransition] = useTransition();

  const refresh = useCallback(
    () =>
      getNotifications().then(
        (result) => {
          setItems(result.items);
          setUnread(result.unread);
        },
        // Signed out or offline — try again on the next tick.
        () => undefined,
      ),
    [],
  );

  // Keep the badge current while the app is open.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Work out whether this browser already receives desktop notifications.
  useEffect(() => {
    void detectPush().then(setPush);
  }, []);

  function enablePush() {
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPush(permission === "denied" ? "denied" : "off");
          toast.error("Notifications were not allowed in this browser.");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
          }));

        const result = await savePushSubscription(subscription.toJSON());
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setPush("on");
        toast.success("Desktop notifications are on for this browser.");
      } catch (error) {
        console.error(error);
        toast.error("Could not turn on desktop notifications.");
      }
    });
  }

  function disablePush() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setPush("off");
      toast.success("Desktop notifications are off for this browser.");
    });
  }

  function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.read) {
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)),
      );
      setUnread((count) => Math.max(0, count - 1));
      void markNotificationRead(item.id);
    }
    if (item.url) router.push(item.url);
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      setItems((current) => current.map((entry) => ({ ...entry, read: true })));
      setUnread(0);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
          <span className="sr-only">
            Notifications{unread > 0 ? ` (${unread} unread)` : ""}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <button
            type="button"
            onClick={markAll}
            disabled={unread === 0 || busy}
            className="text-primary text-xs font-medium hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              Nothing yet. Mailbox limits, disconnects and finished campaigns show up here.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className="hover:bg-muted/50 flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-b-0"
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    item.read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !item.read && "font-medium")}>
                    {item.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">{item.body}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="border-t px-3 py-2">
          {push === "on" ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <BellRing className="size-3.5" />
                Desktop notifications on
              </span>
              <Button size="sm" variant="ghost" onClick={disablePush} disabled={busy}>
                Turn off
              </Button>
            </div>
          ) : push === "off" ? (
            <Button size="sm" variant="outline" className="w-full" onClick={enablePush} disabled={busy}>
              <BellRing className="size-4" />
              Enable desktop notifications
            </Button>
          ) : (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <BellOff className="size-3.5 shrink-0" />
              {push === "denied"
                ? "Notifications are blocked — allow them in your browser's site settings."
                : push === "unconfigured"
                  ? "Desktop notifications aren't set up on the server yet."
                  : "This browser doesn't support desktop notifications."}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
