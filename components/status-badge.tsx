import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  // Contacts
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  REPLIED: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  BOUNCED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  UNSUBSCRIBED: "bg-muted text-muted-foreground",
  DO_NOT_CONTACT: "bg-destructive/10 text-destructive border-destructive/20",
  // Campaigns
  DRAFT: "bg-muted text-muted-foreground",
  SENDING: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  PAUSED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  // Recipients
  PENDING: "bg-muted text-muted-foreground",
  SENT: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  OPENED: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TONES[status], className)}>
      {status.toLowerCase().replace(/_/g, " ")}
    </Badge>
  );
}
