import { formatDistanceToNow } from "date-fns";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TemplateDialog } from "@/components/templates/template-dialog";
import { TemplateRowActions } from "@/components/templates/template-row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: PageProps<"/templates">) {
  const params = await searchParams;
  const showArchived = params.archived === "1";

  const templates = await prisma.template.findMany({
    where: { isArchived: showArchived },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { campaigns: true } } },
  });

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable emails with personalisation variables. Campaigns and automations pick one."
      >
        <Button asChild variant="outline">
          <Link href={showArchived ? "/templates" : "/templates?archived=1"}>
            {showArchived ? "Active templates" : "View archived"}
          </Link>
        </Button>
        <TemplateDialog />
      </PageHeader>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={showArchived ? "Nothing archived" : "No templates yet"}
          description={
            showArchived
              ? "Archived templates stay available for campaigns that already used them."
              : "Write your first email. Use variables like {{firstName}} so every send feels personal."
          }
        >
          {showArchived ? null : <TemplateDialog />}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="truncate text-base">{template.name}</CardTitle>
                  <p className="text-muted-foreground truncate text-sm">{template.subject}</p>
                </div>
                <TemplateRowActions
                  isArchived={template.isArchived}
                  template={{
                    id: template.id,
                    name: template.name,
                    subject: template.subject,
                    body: template.body,
                    description: template.description ?? "",
                  }}
                />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
                  {template.body}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {template._count.campaigns} campaign
                    {template._count.campaigns === 1 ? "" : "s"}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    Updated {formatDistanceToNow(template.updatedAt, { addSuffix: true })}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
