"use client";

import { MoreHorizontal, Pencil, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  disconnectMailbox,
  removeMailbox,
  setMailboxActive,
  updateMailbox,
} from "@/lib/actions/integrations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Props = {
  mailbox: {
    id: string;
    email: string;
    provider: string;
    fromName: string | null;
    dailyLimit: number | null;
    isActive: boolean;
    /** False once the tokens were cleared by a disconnect. */
    connected: boolean;
  };
  defaultLimit: number;
};

export function MailboxActiveSwitch({ mailbox }: Pick<Props, "mailbox">) {
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={mailbox.isActive}
      disabled={pending}
      aria-label={mailbox.isActive ? "Pause mailbox" : "Resume mailbox"}
      onCheckedChange={(isActive) =>
        startTransition(async () => {
          const result = await setMailboxActive(mailbox.id, isActive);
          if (result.ok) {
            toast.success(isActive ? `${mailbox.email} resumed` : `${mailbox.email} paused`);
          } else {
            toast.error(result.error);
          }
        })
      }
    />
  );
}

export function MailboxActions({ mailbox, defaultLimit }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const [fromName, setFromName] = useState(mailbox.fromName ?? "");
  const [dailyLimit, setDailyLimit] = useState(mailbox.dailyLimit?.toString() ?? "");

  function save(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await updateMailbox(mailbox.id, {
        fromName,
        dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : null,
      });

      if (result.ok) {
        toast.success("Mailbox updated");
        setEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = mailbox.connected
        ? await disconnectMailbox(mailbox.id)
        : await removeMailbox(mailbox.id);
      if (result.ok) {
        toast.success(`${mailbox.email} ${mailbox.connected ? "disconnected" : "removed"}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" />
            Sender settings
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href={`/api/integrations/${mailbox.provider === "microsoft" ? "microsoft" : "google"}/connect?hint=${encodeURIComponent(mailbox.email)}`}
            >
              <RefreshCw className="size-4" />
              Reconnect
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            {mailbox.connected ? <Unplug className="size-4" /> : <Trash2 className="size-4" />}
            {mailbox.connected ? "Disconnect" : "Remove"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Sender settings</DialogTitle>
              <DialogDescription>{mailbox.email}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`fromName-${mailbox.id}`}>From name</Label>
                <Input
                  id={`fromName-${mailbox.id}`}
                  placeholder="Your name"
                  value={fromName}
                  maxLength={80}
                  onChange={(event) => setFromName(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Shown to recipients and used for <code>{"{{senderName}}"}</code>. Blank uses
                  your profile name.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`dailyLimit-${mailbox.id}`}>Daily limit</Label>
                <Input
                  id={`dailyLimit-${mailbox.id}`}
                  type="number"
                  min={1}
                  max={2000}
                  placeholder={`${defaultLimit} (default)`}
                  value={dailyLimit}
                  onChange={(event) => setDailyLimit(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Keep new mailboxes low (10–20/day) while they warm up.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mailbox.connected ? "Disconnect" : "Remove"} {mailbox.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mailbox.connected
                ? "Campaigns stop sending from it and its stored access tokens are deleted. Reconnect the same address later to pick its conversations back up."
                : "The mailbox is deleted. Sent history stays, but replies and follow-ups for conversations it started can no longer be sent."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect}>
              {mailbox.connected ? "Disconnect" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
