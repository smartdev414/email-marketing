"use client";

import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteCampaignVariant,
  generateCampaignVariants,
  setCampaignVariantActive,
  updateCampaignVariant,
} from "@/lib/actions/variants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Stats = { sent: number; replied: number };

export type VariantRow = {
  id: string;
  subject: string;
  body: string;
  isActive: boolean;
} & Stats;

type Props = {
  campaignId: string;
  template: { subject: string; body: string } & Stats;
  variants: VariantRow[];
  aiEnabled: boolean;
  /** Finished campaigns keep their stats but get no new variations. */
  canGenerate: boolean;
};

function statsLine({ sent, replied }: Stats) {
  if (sent === 0) return "Not sent yet";
  return `Sent ${sent} · ${replied} replied (${Math.round((replied / sent) * 100)}%)`;
}

export function CampaignVariants({ campaignId, template, variants, aiEnabled, canGenerate }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<VariantRow | null>(null);
  const [deleting, setDeleting] = useState<VariantRow | null>(null);

  const activeCount = variants.filter((variant) => variant.isActive).length;

  function generate() {
    startTransition(async () => {
      const result = await generateCampaignVariants(campaignId, 5);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Added ${result.created} variation${result.created === 1 ? "" : "s"}` +
          (result.rejected ? ` (${result.rejected} failed the checks and were dropped)` : "") +
          ". Read them before the next batch goes out.",
      );
      router.refresh();
    });
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong");
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="text-base">AI variations</CardTitle>
          <CardDescription>
            Each email goes out as the template or one of its active variations, picked at
            random. Greeting, sign-off, links and variables never change.
          </CardDescription>
        </div>
        {canGenerate ? (
          <Button
            size="sm"
            onClick={generate}
            disabled={busy || !aiEnabled}
            title={aiEnabled ? undefined : "Set OPENAI_API_KEY to turn this on"}
          >
            <Sparkles className="size-4" />
            {busy ? "Working…" : "Generate 5"}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {!aiEnabled ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            Add <code>OPENAI_API_KEY</code> to the environment to generate variations.
          </p>
        ) : null}

        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              Original template
            </Badge>
            <span className="text-muted-foreground text-xs">{statsLine(template)}</span>
          </div>
          <p className="mt-2 font-medium">{template.subject}</p>
        </div>

        {variants.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No variations yet — every recipient gets the template as written.
          </p>
        ) : (
          variants.map((variant) => (
            <div
              key={variant.id}
              className={`rounded-lg border p-3 ${variant.isActive ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  {variant.isActive ? "Active" : "Paused"} · {statsLine(variant)}
                </span>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={variant.isActive}
                    disabled={busy}
                    aria-label={variant.isActive ? "Pause variation" : "Use variation"}
                    onCheckedChange={(checked) =>
                      run(() => setCampaignVariantActive(variant.id, checked))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Edit variation"
                    onClick={() => setEditing(variant)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Delete variation"
                    onClick={() => setDeleting(variant)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 font-medium">{variant.subject}</p>
              <p className="text-muted-foreground mt-1 line-clamp-4 text-sm whitespace-pre-line">
                {variant.body}
              </p>
            </div>
          ))
        )}

        {variants.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {activeCount} of {variants.length} variations active.
          </p>
        ) : null}
      </CardContent>

      {editing ? (
        <EditVariantDialog
          key={editing.id}
          variant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this variation?</AlertDialogTitle>
            <AlertDialogDescription>
              Emails already sent with it are counted under the original template from then on.
              Pause it instead to keep its stats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) run(() => deleteCampaignVariant(deleting.id), "Variation deleted");
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function EditVariantDialog({
  variant,
  onClose,
  onSaved,
}: {
  variant: VariantRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateCampaignVariant(variant.id, { subject, body });
      if (result.ok) {
        toast.success("Variation saved");
        onSaved();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit variation</DialogTitle>
            <DialogDescription>
              Keep the {"{{variables}}"} and links as they are — they are filled in per recipient.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`variant-subject-${variant.id}`}>Subject</Label>
              <Input
                id={`variant-subject-${variant.id}`}
                required
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`variant-body-${variant.id}`}>Email</Label>
              <Textarea
                id={`variant-body-${variant.id}`}
                required
                rows={10}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
