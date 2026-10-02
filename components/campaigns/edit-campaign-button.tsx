"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import type { SenderOption } from "@/components/campaigns/create-campaign-dialog";
import {
  EditCampaignDialog,
  type EditableCampaign,
} from "@/components/campaigns/edit-campaign-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  campaign: EditableCampaign;
  templates: { id: string; name: string }[];
  senders: SenderOption[];
};

export function EditCampaignButton({ campaign, templates, senders }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil className="size-4" />
        Edit
      </Button>

      {editing ? (
        <EditCampaignDialog
          campaign={campaign}
          templates={templates}
          senders={senders}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </>
  );
}
