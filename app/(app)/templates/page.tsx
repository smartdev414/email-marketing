import { formatDistanceToNow } from "date-fns";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { UrlSelect } from "@/components/url-select";
import { TemplateCard } from "@/components/templates/template-card";
import { TemplateDialog } from "@/components/templates/template-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Templates" };

const VIEWS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const USAGE_FILTERS = [
  { value: "all", label: "All" },
  { value: "used", label: "In use" },
  { value: "unused", label: "Unused" },
];

const SORTS = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name A–Z" },
  { value: "used", label: "Most used" },
];

export default async function TemplatesPage({ searchParams }: PageProps<"/templates">) {
  const params = await searchParams;
  const showArchived = params.archived === "1";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const usage = USAGE_FILTERS.find((filter) => filter.value === params.usage)?.value ?? "all";
  const sort = SORTS.find((option) => option.value === params.sort)?.value ?? "updated";
  const filtered = Boolean(query) || usage !== "all";

  // "In use" means a campaign or an automation sends it.
  const where: Prisma.TemplateWhereInput = {
    isArchived: showArchived,
    ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    ...(usage === "used"
      ? { OR: [{ campaigns: { some: {} } }, { automations: { some: {} } }] }
      : usage === "unused"
        ? { campaigns: { none: {} }, automations: { none: {} } }
        : {}),
  };

  const templates = await prisma.template.findMany({
    where,
    orderBy: sort === "name" ? { name: "asc" } : { updatedAt: "desc" },
    include: { _count: { select: { campaigns: true, automations: true } } },
  });

  if (sort === "used") {
    const uses = (template: (typeof templates)[number]) =>
      template._count.campaigns + template._count.automations;
    templates.sort((a, b) => uses(b) - uses(a));
  }

  /** Same page with one filter changed and the others kept. */
  function hrefWith(change: { archived?: boolean; usage?: string }) {
    const search = new URLSearchParams();
    if (change.archived ?? showArchived) search.set("archived", "1");
    if (query) search.set("q", query);
    const nextUsage = change.usage ?? usage;
    if (nextUsage !== "all") search.set("usage", nextUsage);
    if (sort !== "updated") search.set("sort", sort);
    return search.size ? `/templates?${search.toString()}` : "/templates";
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable emails with personalisation variables. Campaigns and automations pick one."
      >
        <TemplateDialog />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search template name…" />
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((view) => (
            <Button
              key={view.value}
              asChild
              size="sm"
              variant={(view.value === "archived") === showArchived ? "secondary" : "ghost"}
            >
              <Link href={hrefWith({ archived: view.value === "archived" })}>{view.label}</Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {USAGE_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              asChild
              size="sm"
              variant={usage === filter.value ? "secondary" : "ghost"}
            >
              <Link href={hrefWith({ usage: filter.value })}>{filter.label}</Link>
            </Button>
          ))}
        </div>
        <UrlSelect param="sort" label="Sort templates" defaultValue="updated" options={SORTS} />
        <p className="text-muted-foreground ml-auto text-sm tabular-nums">
          {templates.length.toLocaleString()} template{templates.length === 1 ? "" : "s"}
        </p>
      </div>

      {templates.length === 0 && filtered ? (
        <EmptyState
          icon={FileText}
          title="No matching templates"
          description="Try a different search or filter."
        />
      ) : templates.length === 0 ? (
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
            <TemplateCard
              key={template.id}
              isArchived={template.isArchived}
              template={{
                id: template.id,
                name: template.name,
                subject: template.subject,
                body: template.body,
                description: template.description ?? "",
              }}
            >
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
                  {template.body}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {template._count.campaigns} campaign
                    {template._count.campaigns === 1 ? "" : "s"}
                    {template._count.automations > 0
                      ? ` · ${template._count.automations} automation${template._count.automations === 1 ? "" : "s"}`
                      : ""}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    Updated {formatDistanceToNow(template.updatedAt, { addSuffix: true })}
                  </span>
                </div>
              </CardContent>
            </TemplateCard>
          ))}
        </div>
      )}
    </>
  );
}
