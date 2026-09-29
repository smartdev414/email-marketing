import { formatDistanceToNow } from "date-fns";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReplyBox, SyncInboxButton } from "@/components/inbox/reply-box";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const session = await auth();

  const conversations = await prisma.campaignRecipient.findMany({
    where: {
      status: "REPLIED",
      ...(session?.user?.id ? { assignedToId: session.user.id } : {}),
    },
    orderBy: { repliedAt: "desc" },
    take: 50,
    include: {
      contact: true,
      campaign: { select: { id: true, name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Contacts who replied to your campaigns. Answer here and it goes out in the same Gmail thread."
      >
        <SyncInboxButton />
      </PageHeader>

      {conversations.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No replies yet"
          description="Replies are detected by checking your Gmail threads. Hit Sync Gmail after a campaign has been out for a while."
        >
          <SyncInboxButton />
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {conversations.map((conversation) => (
            <Card key={conversation.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base">
                    {[conversation.contact.firstName, conversation.contact.lastName]
                      .filter(Boolean)
                      .join(" ") || conversation.contact.email}
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {conversation.contact.email}
                    {conversation.contact.company ? ` · ${conversation.contact.company}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-normal" asChild>
                    <Link href={`/campaigns/${conversation.campaign.id}`}>
                      {conversation.campaign.name}
                    </Link>
                  </Badge>
                  {conversation.repliedAt ? (
                    <span className="text-muted-foreground text-xs">
                      replied {formatDistanceToNow(conversation.repliedAt, { addSuffix: true })}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/40 rounded-lg border p-3">
                  <p className="text-muted-foreground mb-1 text-xs">You sent</p>
                  <p className="text-sm font-medium">{conversation.subject ?? "—"}</p>
                </div>
                <ReplyBox recipientId={conversation.id} to={conversation.contact.email} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
