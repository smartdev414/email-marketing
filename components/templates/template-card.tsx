"use client";

import { useState } from "react";

import { TemplateDialog, type TemplateFormValues } from "@/components/templates/template-dialog";
import { TemplateRowActions } from "@/components/templates/template-row-actions";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  template: TemplateFormValues & { id: string };
  isArchived: boolean;
  /** Card body, rendered on the server. */
  children: React.ReactNode;
};

/**
 * A template card that opens the editor wherever it is clicked. The title
 * button stretches over the card; the actions menu sits above it.
 */
export function TemplateCard({ template, isArchived, children }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <Card className="hover:bg-muted/40 focus-within:ring-ring/50 relative flex flex-col transition-colors focus-within:ring-3">
        <CardHeader className="gap-x-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-base">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-none"
              >
                {template.name}
              </button>
            </CardTitle>
            <p className="text-muted-foreground truncate text-sm">{template.subject}</p>
          </div>
          <CardAction className="relative z-10">
            <TemplateRowActions
              template={template}
              isArchived={isArchived}
              onEdit={() => setEditing(true)}
            />
          </CardAction>
        </CardHeader>
        {children}
      </Card>

      {editing ? (
        <TemplateDialog template={template} open={editing} onOpenChange={setEditing} />
      ) : null}
    </>
  );
}
