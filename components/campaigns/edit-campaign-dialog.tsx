"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateCampaign, type CampaignUpdateInput } from "@/lib/actions/campaigns";
import type { SenderOption } from "@/components/campaigns/create-campaign-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";

export type EditableCampaign = CampaignUpdateInput & {
  id: string;
  /** Shown even if archived, so the current choice is never blank. */
  templateName: string;
};

type Props = {
  campaign: EditableCampaign;
  templates: { id: string; name: string }[];
  /** The campaign owner's active, connected mailboxes. */
  senders: SenderOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditCampaignDialog({ campaign, templates, senders, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { id, templateName, ...initial } = campaign;
  const [values, setValues] = useState<CampaignUpdateInput>(initial);

  const templateOptions = templates.some((template) => template.id === initial.templateId)
    ? templates
    : [{ id: initial.templateId, name: `${templateName} (archived)` }, ...templates];

  function toggleSender(senderId: string, checked: boolean) {
    setValues((current) => ({
      ...current,
      senderIds: checked
        ? [...current.senderIds, senderId]
        : current.senderIds.filter((value) => value !== senderId),
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await updateCampaign(id, values);
      if (result.ok) {
        toast.success("Campaign updated");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
            <DialogDescription>
              Changes apply to emails that have not gone out yet. The audience stays as drawn.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`edit-name-${id}`}>Campaign name</Label>
              <Input
                id={`edit-name-${id}`}
                required
                value={values.name}
                onChange={(event) =>
                  setValues((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`edit-template-${id}`}>Template</Label>
              <Select
                value={values.templateId}
                onValueChange={(templateId) =>
                  setValues((current) => ({ ...current, templateId }))
                }
              >
                <SelectTrigger id={`edit-template-${id}`}>
                  <SelectValue placeholder="Pick a template" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Send from</Label>
              {senders.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                  No connected mailboxes — reconnect one on the Integrations page.
                </p>
              ) : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {senders.map((sender) => {
                    const checkboxId = `edit-sender-${id}-${sender.id}`;
                    return (
                      <label
                        key={sender.id}
                        htmlFor={checkboxId}
                        className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={values.senderIds.includes(sender.id)}
                          onCheckedChange={(checked) => toggleSender(sender.id, checked === true)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{sender.email}</span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {sender.remaining}/{sender.limit} left today
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:max-w-[50%]">
              <Label htmlFor={`edit-batch-${id}`}>Emails per batch</Label>
              <Input
                id={`edit-batch-${id}`}
                type="number"
                min={1}
                max={500}
                required
                value={values.batchSize}
                onChange={(event) =>
                  setValues((current) => ({ ...current, batchSize: Number(event.target.value) }))
                }
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor={`edit-opens-${id}`}>Track opens</Label>
                  <p className="text-muted-foreground text-xs">
                    Adds a pixel. Pixels hurt cold-email deliverability.
                  </p>
                </div>
                <Switch
                  id={`edit-opens-${id}`}
                  checked={values.trackOpens ?? false}
                  onCheckedChange={(trackOpens) =>
                    setValues((current) => ({ ...current, trackOpens }))
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor={`edit-clicks-${id}`}>Track clicks</Label>
                  <p className="text-muted-foreground text-xs">Rewrites links through a redirect.</p>
                </div>
                <Switch
                  id={`edit-clicks-${id}`}
                  checked={values.trackClicks ?? false}
                  onCheckedChange={(trackClicks) =>
                    setValues((current) => ({ ...current, trackClicks }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || values.senderIds.length === 0}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
