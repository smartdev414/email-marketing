"use client";

import { MoreHorizontal, Pencil, Trash2, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteContacts, setContactStatus } from "@/lib/actions/contacts";
import { ContactDialog, type ContactFormValues } from "@/components/contacts/contact-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ContactRowActions({ contact }: { contact: ContactFormValues & { id: string } }) {
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
            onSelect={() =>
              run(
                () => setContactStatus([contact.id], "DO_NOT_CONTACT"),
                "Marked do not contact",
              )
            }
          >
            <UserX className="size-4" />
            Do not contact
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => run(() => deleteContacts([contact.id]), "Contact deleted")}
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <ContactDialog contact={contact} open={editing} onOpenChange={setEditing} />
      ) : null}
    </>
  );
}
