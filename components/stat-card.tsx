import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-lg">
            <Icon className="size-4" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
