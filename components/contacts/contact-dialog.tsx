"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createContact, updateContact, type ContactInput } from "@/lib/actions/contacts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUSES = [
  "ACTIVE",
  "REPLIED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "DO_NOT_CONTACT",
] as const;

export type ContactFormValues = ContactInput & { id?: string };

type Props = {
  contact?: ContactFormValues;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ContactDialog({ contact, trigger, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [values, setValues] = useState<ContactInput>({
    email: contact?.email ?? "",
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    company: contact?.company ?? "",
    jobTitle: contact?.jobTitle ?? "",
    phone: contact?.phone ?? "",
    country: contact?.country ?? "",
    status: contact?.status ?? "ACTIVE",
    tags: contact?.tags ?? "",
    notes: contact?.notes ?? "",
  });

  function field<K extends keyof ContactInput>(key: K) {
    return {
      value: (values[key] ?? "") as string,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = contact?.id
        ? await updateContact(contact.id, values)
        : await createContact(values);

      if (result.ok) {
        toast.success(contact?.id ? "Contact updated" : "Contact added");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : isControlled ? null : (
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            Add contact
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{contact?.id ? "Edit contact" : "Add contact"}</DialogTitle>
            <DialogDescription>
              Only the email is required — the rest fills in your template variables.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required {...field("email")} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" {...field("firstName")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" {...field("lastName")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="company">Company</Label>
                <Input id="company" {...field("company")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input id="jobTitle" {...field("jobTitle")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="country">Country</Label>
                <Input id="country" {...field("country")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={values.status ?? "ACTIVE"}
                  onValueChange={(status) =>
                    setValues((current) => ({
                      ...current,
                      status: status as ContactInput["status"],
                    }))
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.toLowerCase().replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" placeholder="saas, enterprise" {...field("tags")} />
              <p className="text-muted-foreground text-xs">
                Comma separated. Campaigns can target a single tag.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={3} {...field("notes")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
