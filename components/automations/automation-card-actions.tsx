"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteAutomation,
  runAutomationsNow,
  setAutomationActive,
} from "@/lib/actions/automations";
import {
  AutomationDialog,
  type AutomationFormValues,
} from "@/components/automations/automation-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

type Props = {
  automation: AutomationFormValues & { id: string };
  templates: { id: string; name: string }[];
};

export function AutomationCardActions({ automation, templates }: Props) {
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Something went wrong");
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Switch
        checked={automation.isActive ?? false}
        aria-label="Toggle automation"
        onCheckedChange={(isActive) =>
          run(
            () => setAutomationActive(automation.id, isActive),
            isActive ? "Automation activated" : "Automation paused",
          )
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => run(() => deleteAutomation(automation.id), "Automation deleted")}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <AutomationDialog
          templates={templates}
          automation={automation}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </div>
  );
}

export function RunAutomationsButton() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() =>
        startTransition(async () => {
          const result = await runAutomationsNow();
          if (!result.ok) toast.error(result.error);
          else
            toast.success(
              result.sent > 0
                ? `Sent ${result.sent} follow-up${result.sent === 1 ? "" : "s"}`
                : "Nothing matched yet",
            );
          router.refresh();
        })
      }
    >
      {busy ? "Running…" : "Run now"}
    </Button>
  );
}
