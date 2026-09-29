"use client";

import { Plus, Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  countEligibleContacts,
  createCampaign,
  type CampaignInput,
} from "@/lib/actions/campaigns";
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

type Props = {
  templates: { id: string; name: string; subject: string }[];
  tags: string[];
};

export function CreateCampaignDialog({ templates, tags }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [eligible, setEligible] = useState<number | null>(null);

  const [values, setValues] = useState<CampaignInput>({
    name: "",
    description: "",
    templateId: templates[0]?.id ?? "",
    audienceSize: 50,
    batchSize: 25,
    tag: "",
    excludeContacted: true,
    trackOpens: false,
    trackClicks: false,
  });

  // Show the size of the pool the random draw will pick from.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void countEligibleContacts(values.tag || undefined, values.excludeContacted ?? true).then(
      (count) => {
        if (!cancelled) setEligible(count);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, values.tag, values.excludeContacted]);

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
              Pick a template and how many contacts to draw. The audience is sampled at random
              from everyone who matches.
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
              <Label htmlFor="tag">Audience tag</Label>
              <Select
                value={values.tag || "all"}
                onValueChange={(tag) =>
                  setValues((current) => ({ ...current, tag: tag === "all" ? "" : tag }))
                }
              >
                <SelectTrigger id="tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every active contact</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button type="submit" disabled={pending || !values.templateId}>
              {pending ? "Creating…" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
