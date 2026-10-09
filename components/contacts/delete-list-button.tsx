"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteContactList } from "@/lib/actions/contact-lists";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Deletes the list being viewed; its contacts stay in the database. */
export function DeleteListButton({ list }: { list: { id: string; name: string } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteContactList(list.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`List “${list.name}” deleted`);
      router.push("/contacts");
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          <Trash2 className="size-4" />
          Delete list
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete list &ldquo;{list.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Only the list is removed. Its contacts stay in your contacts, and campaigns that
            already used it keep their audience.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Delete list</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
