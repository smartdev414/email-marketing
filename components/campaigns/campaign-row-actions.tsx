"use client";

import {
  ExternalLink,
  Copy,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Rocket,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteCampaign,
  duplicateCampaign,
  setCampaignPaused,
  startCampaign,
} from "@/lib/actions/campaigns";
import type { SenderOption } from "@/components/campaigns/create-campaign-dialog";
import {
  EditCampaignDialog,
  type EditableCampaign,
} from "@/components/campaigns/edit-campaign-dialog";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  campaign: EditableCampaign & { status: string };
  templates: { id: string; name: string }[];
  senders: SenderOption[];
};

export function CampaignRowActions({ campaign, templates, senders }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Something went wrong");
      router.refresh();
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateCampaign(campaign.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Duplicated as a draft with ${result.picked} new contacts`);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={busy}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Campaign actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`/campaigns/${campaign.id}`}>
              <ExternalLink className="size-4" />
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy className="size-4" />
            Duplicate
          </DropdownMenuItem>

          {campaign.status === "DRAFT" ? (
            <DropdownMenuItem
              onSelect={() => run(() => startCampaign(campaign.id), "Campaign started")}
            >
              <Rocket className="size-4" />
              Start sending
            </DropdownMenuItem>
          ) : campaign.status === "SENDING" ? (
            <DropdownMenuItem
              onSelect={() => run(() => setCampaignPaused(campaign.id, true), "Campaign paused")}
            >
              <Pause className="size-4" />
              Pause
            </DropdownMenuItem>
          ) : campaign.status === "PAUSED" ? (
            <DropdownMenuItem
              onSelect={() => run(() => setCampaignPaused(campaign.id, false), "Campaign resumed")}
            >
              <Play className="size-4" />
              Resume
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <EditCampaignDialog
          campaign={campaign}
          templates={templates}
          senders={senders}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{campaign.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The campaign and its tracking history are removed. Emails already sent stay in
              Gmail, and contacts are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run(() => deleteCampaign(campaign.id), "Campaign deleted")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
