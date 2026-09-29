"use client";

import { Database } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { importFromWarehouse, type WarehouseImportInput } from "@/lib/actions/warehouse";
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

export function WarehouseImportDialog({
  estimatedRows,
  imported,
}: {
  estimatedRows: number;
  imported: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<WarehouseImportInput>({
    limit: 1000,
    tag: "",
    label: "",
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await importFromWarehouse({
        limit: Number(values.limit),
        tag: values.tag || undefined,
        label: values.label || undefined,
      });

      if (result.ok) {
        toast.success(`Imported ${result.imported.toLocaleString()} contacts`);
        if (result.duplicates + result.rejected > 0) {
          toast.info(
            `Skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} and ${result.rejected} screened out, from ${result.scanned.toLocaleString()} rows scanned.`,
          );
        }
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Database className="size-4" />
          Pull from warehouse
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
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
              <Label htmlFor="wh-limit">How many to pull</Label>
              <Input
                id="wh-limit"
                type="number"
                min={1}
                max={50000}
                required
                value={values.limit}
                onChange={(event) =>
                  setValues((current) => ({ ...current, limit: Number(event.target.value) }))
                }
              />
              <p className="text-muted-foreground text-xs">
                Drawn at random across the whole table when no tag filter is set.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="wh-tag">Filter by warehouse tag</Label>
              <Input
                id="wh-tag"
                placeholder="ae-lead"
                value={values.tag ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, tag: event.target.value }))
                }
              />
              <p className="text-muted-foreground text-xs">
                Matches <code>hl_contacts.tags</code> as a substring. Leave blank for a random
                sample of everything.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="wh-label">Label this batch</Label>
              <Input
                id="wh-label"
                placeholder="oct-batch-1"
                value={values.label ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, label: event.target.value }))
                }
              />
              <p className="text-muted-foreground text-xs">
                Added as a tag so a campaign can target exactly this batch.
              </p>
            </div>

            <p className="text-muted-foreground border-t pt-3 text-xs">
              Role mailboxes, disposable domains, unsubscribes and bounced addresses are filtered
              out during the pull, and nothing already imported is pulled twice.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Pulling…" : "Pull contacts"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
