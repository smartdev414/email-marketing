"use client";

import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteTemplate,
  duplicateTemplate,
  setTemplateArchived,
} from "@/lib/actions/templates";
import { TemplateDialog, type TemplateFormValues } from "@/components/templates/template-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  template: TemplateFormValues & { id: string };
  isArchived: boolean;
};

export function TemplateRowActions({ template, isArchived }: Props) {
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run(() => duplicateTemplate(template.id), "Template duplicated")}
          >
            <Copy className="size-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run(
                () => setTemplateArchived(template.id, !isArchived),
                isArchived ? "Template restored" : "Template archived",
              )
            }
          >
            {isArchived ? (
              <ArchiveRestore className="size-4" />
            ) : (
              <Archive className="size-4" />
            )}
            {isArchived ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => run(() => deleteTemplate(template.id), "Template deleted")}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <TemplateDialog template={template} open={editing} onOpenChange={setEditing} />
      ) : null}
    </>
  );
}
