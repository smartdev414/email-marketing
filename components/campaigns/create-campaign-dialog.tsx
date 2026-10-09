"use client";

import { Mail, Plus, Shuffle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  countEligibleContacts,
  createCampaign,
  type CampaignInput,
} from "@/lib/actions/campaigns";
import { SenderPicker } from "@/components/campaigns/sender-picker";
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

export type SenderOption = {
  id: string;
  email: string;
  /** Emails this mailbox may still send today. */
  remaining: number;
  limit: number;
};

type Props = {
  templates: { id: string; name: string; subject: string }[];
  /** The current user's active, connected mailboxes. */
  senders: SenderOption[];
  /** Contact lists the audience can be drawn from. */
  lists?: { id: string; name: string; size: number }[];
};

const ALL_CONTACTS = "__all";

export function CreateCampaignDialog({ templates, senders, lists = [] }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Tagged with the audience it was counted for, so a stale count never shows.
  const [counted, setCounted] = useState<{ key: string; count: number } | null>(null);

  const [values, setValues] = useState<CampaignInput>({
    name: "",
    description: "",
    templateId: templates[0]?.id ?? "",
    audienceSize: 50,
    batchSize: 25,
    excludeContacted: true,
    trackOpens: false,
    trackClicks: false,
    // Nothing pre-ticked: the sender list is a deliberate choice.
    senderIds: [],
    listId: null,
  });

  // Show the size of the pool the random draw will pick from.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const key = `${values.excludeContacted ?? true}|${values.listId ?? ""}`;
    void countEligibleContacts(values.excludeContacted ?? true, values.listId).then((count) => {
      if (!cancelled) setCounted({ key, count });
    });

    return () => {
      cancelled = true;
    };
  }, [open, values.excludeContacted, values.listId]);

  const audienceKey = `${values.excludeContacted ?? true}|${values.listId ?? ""}`;
  const eligible = counted?.key === audienceKey ? counted.count : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await createCampaign(values);

      if (result.ok) {
        toast.success(`Campaign created with ${result.picked} contacts`);
        setOpen(false);
        router.push(`/campaigns/${result.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={templates.length === 0}>
          <Plus className="size-4" />
          New campaign
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Pick a template, an audience and how many contacts to draw. The audience is
              sampled at random from the active contacts in it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                required
                placeholder="Q4 outreach — SaaS founders"
                value={values.name}
                onChange={(event) =>
                  setValues((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="template">Template</Label>
              <Select
                value={values.templateId}
                onValueChange={(templateId) =>
                  setValues((current) => ({ ...current, templateId }))
                }
              >
                <SelectTrigger id="template">
                  <SelectValue placeholder="Pick a template" />
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

            <div className="grid gap-2">
              <Label>Send from</Label>
              {senders.length === 0 ? (
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
                  <span>No mailboxes connected yet.</span>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/integrations">
                      <Mail className="size-4" />
                      Connect a mailbox
                    </Link>
                  </Button>
                </div>
              ) : (
                <SenderPicker
                  idPrefix="sender"
                  senders={senders}
                  value={values.senderIds}
                  onChange={(senderIds) => setValues((current) => ({ ...current, senderIds }))}
                />
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="audience">Audience</Label>
              <Select
                value={values.listId ?? ALL_CONTACTS}
                onValueChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    listId: value === ALL_CONTACTS ? null : value,
                  }))
                }
              >
                <SelectTrigger id="audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CONTACTS}>All contacts</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({list.size.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lists.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Import a file on the Contacts page to send to a specific list.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="audienceSize">How many contacts</Label>
                <Input
                  id="audienceSize"
                  type="number"
                  min={1}
                  max={5000}
                  required
                  value={values.audienceSize}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      audienceSize: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="batchSize">Emails per batch</Label>
                <Input
                  id="batchSize"
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={values.batchSize}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      batchSize: Number(event.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <Shuffle className="size-3.5" />
              {eligible === null
                ? "Counting eligible contacts…"
                : `${eligible.toLocaleString()} contacts match — ${Math.min(
                    eligible,
                    Number(values.audienceSize) || 0,
                  ).toLocaleString()} will be drawn at random.`}
            </p>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="excludeContacted">Skip already-contacted</Label>
                  <p className="text-muted-foreground text-xs">
                    Never email someone twice across campaigns.
                  </p>
                </div>
                <Switch
                  id="excludeContacted"
                  checked={values.excludeContacted ?? true}
                  onCheckedChange={(excludeContacted) =>
                    setValues((current) => ({ ...current, excludeContacted }))
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="trackOpens">Track opens</Label>
                  <p className="text-muted-foreground text-xs">
                    Adds a pixel. Off by default — pixels hurt cold-email deliverability.
                  </p>
                </div>
                <Switch
                  id="trackOpens"
                  checked={values.trackOpens ?? false}
                  onCheckedChange={(trackOpens) =>
                    setValues((current) => ({ ...current, trackOpens }))
                  }
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="trackClicks">Track clicks</Label>
                  <p className="text-muted-foreground text-xs">
                    Rewrites links through a redirect.
                  </p>
                </div>
                <Switch
                  id="trackClicks"
                  checked={values.trackClicks ?? false}
                  onCheckedChange={(trackClicks) =>
                    setValues((current) => ({ ...current, trackClicks }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !values.templateId || values.senderIds.length === 0}
            >
              {pending ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
