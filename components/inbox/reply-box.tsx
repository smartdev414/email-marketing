"use client";

import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { replyToRecipient, syncBounces, syncReplies } from "@/lib/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReplyBox({ recipientId, to }: { recipientId: string; to: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await replyToRecipient(recipientId, body);
      if (result.ok) {
        toast.success(`Reply sent to ${to}`);
        setBody("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        rows={3}
        placeholder={`Reply to ${to}…`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={send} disabled={pending || body.trim().length < 2}>
          <Send className="size-4" />
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}

export function SyncInboxButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const [replies, bounces] = await Promise.all([syncReplies(), syncBounces()]);

          if (!replies.ok) toast.error(replies.error);
          else
            toast.success(
              replies.replies > 0
                ? `${replies.replies} new repl${replies.replies === 1 ? "y" : "ies"}`
                : "No new replies",
            );

          if (bounces.ok && bounces.bounced > 0) {
            toast.warning(`${bounces.bounced} bounced — addresses suppressed`);
          }

          router.refresh();
        })
      }
    >
      <RefreshCw className="size-4" />
      {pending ? "Checking Gmail…" : "Sync Gmail"}
    </Button>
  );
}
