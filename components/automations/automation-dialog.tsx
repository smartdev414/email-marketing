"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createAutomation,
  updateAutomation,
  type AutomationInput,
} from "@/lib/actions/automations";
import { TRIGGER_OPTIONS } from "@/lib/automation-triggers";
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
import { Switch } from "@/components/ui/switch";

export type AutomationFormValues = AutomationInput & { id?: string };

type Props = {
  templates: { id: string; name: string }[];
  automation?: AutomationFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AutomationDialog({ templates, automation, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [values, setValues] = useState<AutomationInput>({
    name: automation?.name ?? "",
    description: automation?.description ?? "",
    trigger: automation?.trigger ?? "NO_REPLY_AFTER_DAYS",
    delayDays: automation?.delayDays ?? 3,
    templateId: automation?.templateId ?? templates[0]?.id ?? "",
    isActive: automation?.isActive ?? false,
  });

  const selectedTrigger = TRIGGER_OPTIONS.find((option) => option.value === values.trigger);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = automation?.id
        ? await updateAutomation(automation.id, values)
        : await createAutomation(values);

      if (result.ok) {
        toast.success(automation?.id ? "Automation updated" : "Automation created");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          <Button disabled={templates.length === 0}>
            <Plus className="size-4" />
            New automation
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{automation?.id ? "Edit automation" : "New automation"}</DialogTitle>
            <DialogDescription>
              A follow-up rule. It replies inside the original email thread, and each contact
              only ever receives it once.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="automation-name">Name</Label>
              <Input
                id="automation-name"
                required
                placeholder="Follow up after 3 days"
                value={values.name}
                onChange={(event) =>
                  setValues((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="trigger">When</Label>
              <Select
                value={values.trigger}
                onValueChange={(trigger) =>
                  setValues((current) => ({
                    ...current,
                    trigger: trigger as AutomationInput["trigger"],
                  }))
                }
              >
                <SelectTrigger id="trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTrigger ? (
                <p className="text-muted-foreground text-xs">{selectedTrigger.hint}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="delayDays">Wait (days)</Label>
                <Input
                  id="delayDays"
                  type="number"
                  min={1}
                  max={60}
                  required
                  value={values.delayDays}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      delayDays: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="automation-template">Send template</Label>
                <Select
                  value={values.templateId}
                  onValueChange={(templateId) =>
                    setValues((current) => ({ ...current, templateId }))
                  }
                >
                  <SelectTrigger id="automation-template">
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="isActive">Active</Label>
                <p className="text-muted-foreground text-xs">
                  Inactive rules are never evaluated.
                </p>
              </div>
              <Switch
                id="isActive"
                checked={values.isActive ?? false}
                onCheckedChange={(isActive) =>
                  setValues((current) => ({ ...current, isActive }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !values.templateId}>
              {pending ? "Saving…" : "Save automation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
