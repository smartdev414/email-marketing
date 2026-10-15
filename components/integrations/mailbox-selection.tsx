"use client";

import { Trash2 } from "lucide-react";
import { createContext, useContext, useState, useTransition } from "react";
import { toast } from "sonner";

import { removeMailboxes } from "@/lib/actions/integrations";
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
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Row selection for the mailbox table. The table itself is server-rendered;
 * these client pieces share the selected ids through context.
 */

type Selection = {
  selected: Set<string>;
  toggle: (id: string, checked: boolean) => void;
  setMany: (ids: string[], checked: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection() {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("Wrap mailbox selection controls in MailboxSelectionProvider");
  return selection;
}

export function MailboxSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const setMany = (ids: string[], checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <SelectionContext.Provider
      value={{
        selected,
        toggle: (id, checked) => setMany([id], checked),
        setMany,
        clear: () => setSelected(new Set()),
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

/** Header checkbox: selects or clears every mailbox on the current page. */
export function MailboxSelectAll({ ids }: { ids: string[] }) {
  const { selected, setMany } = useSelection();
  const count = ids.filter((id) => selected.has(id)).length;

  return (
    <Checkbox
      aria-label="Select all mailboxes on this page"
      checked={count > 0 && count === ids.length ? true : count > 0 ? "indeterminate" : false}
      onCheckedChange={(checked) => setMany(ids, checked === true)}
    />
  );
}

export function MailboxRowCheckbox({ id, email }: { id: string; email: string }) {
  const { selected, toggle } = useSelection();

  return (
    <Checkbox
      aria-label={`Select ${email}`}
      checked={selected.has(id)}
      onCheckedChange={(checked) => toggle(id, checked === true)}
    />
  );
}

/** Shown while anything is selected: the count, Clear, and Delete selected. */
export function MailboxBulkBar() {
  const { selected, clear } = useSelection();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;

  function remove() {
    startTransition(async () => {
      const result = await removeMailboxes([...selected]);
      if (result.ok) {
        toast.success(`${result.removed} mailbox${result.removed === 1 ? "" : "es"} deleted`);
        clear();
        setConfirming(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="bg-muted/50 mx-(--card-spacing) mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="font-medium tabular-nums">
        {selected.size} selected
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={clear}>
        Clear
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="ml-auto"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
        Delete selected
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} mailbox{selected.size === 1 ? "" : "es"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are removed from every campaign and their stored logins are deleted. Sent
              history stays, but replies and follow-ups for conversations they started can no
              longer be sent. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                // Keep the dialog open until the delete finishes.
                event.preventDefault();
                remove();
              }}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
