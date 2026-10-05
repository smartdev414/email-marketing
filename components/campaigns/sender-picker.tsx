"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

import type { SenderOption } from "@/components/campaigns/create-campaign-dialog";
import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  /** Prefix for element ids, so two pickers on one page never collide. */
  idPrefix: string;
  senders: SenderOption[];
  value: string[];
  onChange: (senderIds: string[]) => void;
};

/**
 * Mailbox checklist for campaign forms. A mailbox with nothing left today
 * cannot be newly ticked, but one that is already ticked can still be
 * unticked, so an existing campaign can drop it.
 */
export function SenderPicker({ idPrefix, senders, value, onChange }: Props) {
  const [term, setTerm] = useState("");

  const needle = term.trim().toLowerCase();
  const shown = needle
    ? senders.filter((sender) => sender.email.toLowerCase().includes(needle))
    : senders;
  const available = shown.filter((sender) => sender.remaining > 0);

  const selected = senders.filter((sender) => value.includes(sender.id));
  const capacityToday = selected.reduce((total, sender) => total + sender.remaining, 0);

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...value, id] : value.filter((senderId) => senderId !== id));
  }

  function selectAvailable() {
    onChange([...new Set([...value, ...available.map((sender) => sender.id)])]);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search mailboxes…"
            aria-label="Search mailboxes"
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full rounded-lg border bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:ring-3"
          />
        </div>
        <button
          type="button"
          onClick={selectAvailable}
          disabled={available.length === 0}
          className="text-primary shrink-0 text-xs font-medium hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Select all available
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={value.length === 0}
          className="text-muted-foreground shrink-0 text-xs font-medium hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
        {shown.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">No matching mailboxes</p>
        ) : (
          shown.map((sender) => {
            const id = `${idPrefix}-${sender.id}`;
            const checked = value.includes(sender.id);
            const exhausted = sender.remaining <= 0;
            const disabled = exhausted && !checked;

            return (
              <label
                key={sender.id}
                htmlFor={id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5",
                  disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50 cursor-pointer",
                )}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) => toggle(sender.id, next === true)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{sender.email}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    exhausted ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {exhausted ? "Limit reached" : `${sender.remaining}/${sender.limit} left today`}
                </span>
              </label>
            );
          })
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {selected.length === 0
          ? "Pick at least one mailbox."
          : `Emails rotate across ${selected.length} mailbox${
              selected.length === 1 ? "" : "es"
            } — up to ${capacityToday} can go out today.`}
      </p>
    </div>
  );
}
