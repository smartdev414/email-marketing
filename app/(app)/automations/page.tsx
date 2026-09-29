import { formatDistanceToNow } from "date-fns";
import { Clock, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  AutomationCardActions,
  RunAutomationsButton,
} from "@/components/automations/automation-card-actions";
import { AutomationDialog } from "@/components/automations/automation-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TRIGGER_LABELS } from "@/lib/automation-triggers";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const [automations, templates] = await Promise.all([
    prisma.automation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { name: true } },
        _count: { select: { runs: true } },
      },
    }),
    prisma.template.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Automations"
        description="Follow-up rules that fire on their own. They reply in the original thread, once per contact."
      >
        <RunAutomationsButton />
        <AutomationDialog templates={templates} />
      </PageHeader>

      {templates.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Write a follow-up template first"
          description="An automation sends a template, so create one before setting up a rule."
        >
          <Button asChild size="sm">
            <Link href="/templates">Go to templates</Link>
          </Button>
        </EmptyState>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="A common setup: follow up 3 days later when a contact has not replied."
        >
          <AutomationDialog templates={templates} />
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {automations.map((automation) => (
            <Card key={automation.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="truncate text-base">{automation.name}</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {TRIGGER_LABELS[automation.trigger]} · waits {automation.delayDays} day
                    {automation.delayDays === 1 ? "" : "s"}
                  </p>
                </div>
                <AutomationCardActions
                  templates={templates}
                  automation={{
                    id: automation.id,
                    name: automation.name,
                    description: automation.description ?? "",
                    trigger: automation.trigger,
                    delayDays: automation.delayDays,
                    templateId: automation.templateId,
                    isActive: automation.isActive,
                  }}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                {automation.description ? (
                  <p className="text-muted-foreground text-sm">{automation.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={automation.isActive ? "default" : "secondary"}>
                    {automation.isActive ? "Active" : "Paused"}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    Sends {automation.template.name}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {automation._count.runs} sent
                  </Badge>
                </div>
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Clock className="size-3.5" />
                  {automation.lastRunAt
                    ? `Last checked ${formatDistanceToNow(automation.lastRunAt, { addSuffix: true })}`
                    : "Never run yet"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Running automations on a schedule</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            &ldquo;Run now&rdquo; evaluates every active rule immediately. For hands-off
            follow-ups, call the cron endpoint once a day:
          </p>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            {`curl -H "Authorization: Bearer $CRON_SECRET" \\
  https://your-domain.com/api/cron/automations`}
          </pre>
        </CardContent>
      </Card>
    </>
  );
}
