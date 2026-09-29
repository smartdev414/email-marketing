"use client";

import { Database } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { importFromWarehouse } from "@/lib/actions/warehouse";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Progress = { scanned: number; imported: number; duplicates: number; rejected: number };

const EMPTY: Progress = { scanned: 0, imported: 0, duplicates: 0, rejected: 0 };

export function WarehouseImportDialog({
  estimatedRows,
  imported,
}: {
  estimatedRows: number;
  imported: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [limit, setLimit] = useState("");
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const stopRequested = useRef(false);
  // Survives a Stop, so the next run resumes instead of rescanning from the top.
  const resumeFrom = useRef<string | undefined>(undefined);

  async function run(event: React.FormEvent) {
    event.preventDefault();

    const max = limit ? Number(limit) : undefined;
    const totals = { ...EMPTY };
    let cursor = resumeFrom.current;

    stopRequested.current = false;
    setRunning(true);
    setProgress(totals);

    try {
      // Each call works for ~20s and hands back a cursor; keep going until the
      // warehouse is drained, the cap is hit, or the user stops it.
      while (!stopRequested.current) {
        const remaining = max !== undefined ? max - totals.imported : undefined;
        if (remaining !== undefined && remaining <= 0) break;

        const result = await importFromWarehouse({ cursor, limit: remaining });

        if (!result.ok) {
          toast.error(result.error);
          break;
        }

        totals.scanned += result.scanned;
        totals.imported += result.imported;
        totals.duplicates += result.duplicates;
        totals.rejected += result.rejected;
        setProgress({ ...totals });

        cursor = result.cursor;
        resumeFrom.current = result.done ? undefined : cursor;
        if (result.done) break;
      }

      if (totals.scanned === 0) {
        toast.info("Nothing new to pull — every sendable warehouse row is already a contact.");
      } else {
        toast.success(`Imported ${totals.imported.toLocaleString()} contacts`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Warehouse import failed");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Database className="size-4" />
          Pull from warehouse
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={run}>
          <DialogHeader>
            <DialogTitle>Pull contacts from the warehouse</DialogTitle>
            <DialogDescription>
              {estimatedRows > 0
                ? `About ${estimatedRows.toLocaleString()} rows in hl_contacts, ${imported.toLocaleString()} already pulled in.`
                : "hl_contacts looks empty — load the SQL dump first."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="wh-limit">Maximum to pull</Label>
              <Input
                id="wh-limit"
                type="number"
                min={1}
                placeholder="Everything"
                disabled={running}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Leave blank to pull every sendable row. Large warehouses take a while — keep this
                dialog open, or stop and run it again later to pick up where it left off.
              </p>
            </div>

            {running || progress.scanned > 0 ? (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {progress.imported.toLocaleString()} imported
                  {running ? "…" : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {progress.scanned.toLocaleString()} rows scanned ·{" "}
                  {progress.duplicates.toLocaleString()} duplicates ·{" "}
                  {progress.rejected.toLocaleString()} screened out
                </p>
              </div>
            ) : null}

            <p className="text-muted-foreground border-t pt-3 text-xs">
              Role mailboxes, disposable domains, spam rows, unsubscribes and bounced addresses are
              filtered out during the pull, and nothing already imported is pulled twice.
            </p>
          </div>

          <DialogFooter>
            {running ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopRequested.current = true;
                }}
              >
                Stop
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            )}
            <Button type="submit" disabled={running}>
              {running ? "Pulling…" : "Pull contacts"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
