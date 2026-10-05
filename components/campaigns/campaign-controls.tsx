"use client";

import { Pause, Play, Rocket, RefreshCw, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  deleteCampaign,
  sendCampaignBatch,
  setCampaignPaused,
  startCampaign,
  syncReplies,
} from "@/lib/actions/campaigns";
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

type Props = {
  campaignId: string;
  status: string;
  pending: number;
  batchSize: number;
};

export function CampaignControls({ campaignId, status, pending, batchSize }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const isDraft = status === "DRAFT";
  const isPaused = status === "PAUSED";
  const nextBatch = Math.min(pending, batchSize);

  function send() {
    startTransition(async () => {
      const result = await sendCampaignBatch(campaignId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.sent === 0 && result.failed === 0 && result.skipped === 0) {
        toast.info("Nothing left to send — campaign complete.");
      } else {
        const details = [
          result.failed ? `${result.failed} failed` : null,
          result.skipped ? `${result.skipped} skipped` : null,
        ].filter(Boolean);

        toast.success(
          `Sent ${result.sent}${details.length ? ` (${details.join(", ")})` : ""}. ${result.remaining} left.`,
        );
      }

      if (result.warning) toast.warning(result.warning);

      if (result.quotaReached) {
        toast.warning(
          "Every mailbox on this campaign hit its daily limit — continue tomorrow to protect your domains.",
        );
      }

      router.refresh();
    });
  }

  function sync() {
    startTransition(async () => {
      const result = await syncReplies(campaignId);
      if (!result.ok) toast.error(result.error);
      else
        toast.success(
          result.replies > 0 ? `${result.replies} new repl${result.replies === 1 ? "y" : "ies"}` : "No new replies",
        );
      router.refresh();
    });
  }

  function start() {
    startTransition(async () => {
      const result = await startCampaign(campaignId);
      if (!result.ok) toast.error(result.error);
      else toast.success("Campaign started — batches go out automatically during sending hours.");
      router.refresh();
    });
  }

  function togglePause() {
    startTransition(async () => {
      const result = await setCampaignPaused(campaignId, !isPaused);
      if (!result.ok) toast.error(result.error);
      else toast.success(isPaused ? "Campaign resumed" : "Campaign paused");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCampaign(campaignId);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Campaign deleted");
        router.push("/campaigns");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={sync} disabled={busy}>
        <RefreshCw className="size-4" />
        Check replies
      </Button>

      {isDraft && pending > 0 ? (
        <Button onClick={start} disabled={busy}>
          <Rocket className="size-4" />
          Start sending
        </Button>
      ) : pending > 0 ? (
        <Button variant="outline" onClick={togglePause} disabled={busy}>
          {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {isPaused ? "Resume" : "Pause"}
        </Button>
      ) : null}

      <Button
        variant={isDraft ? "outline" : "default"}
        onClick={send}
        disabled={busy || pending === 0 || isPaused}
      >
        <Send className="size-4" />
        {pending === 0
          ? "All sent"
          : busy
            ? "Sending…"
            : `Send next ${nextBatch}`}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" disabled={busy}>
            <Trash2 className="size-4" />
            <span className="sr-only">Delete campaign</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              The campaign and its tracking history are removed. Emails already sent stay in
              your mailbox, and contacts are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
