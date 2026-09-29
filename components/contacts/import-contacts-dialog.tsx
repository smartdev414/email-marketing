"use client";

import { Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { importContactsCsv } from "@/lib/actions/contacts";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SAMPLE = `email,first name,last name,company,job title,country,tags
jordan@acme.com,Jordan,Lee,Acme Inc.,Head of Sales,United States,saas`;

export function ImportContactsDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
  }

  function submit() {
    startTransition(async () => {
      const result = await importContactsCsv(csv);

      if (result.ok) {
        toast.success(`Imported ${result.created} new, updated ${result.updated}`);

        if (result.skipped > 0) {
          const reasons = Object.entries(result.rejected)
            .map(([reason, count]) => `${count} ${reason}`)
            .join(", ");
          toast.warning(`Skipped ${result.skipped} for list hygiene: ${reasons}`);
        }

        setCsv("");
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
          <Upload className="size-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV or paste it below. The first row must be a header row containing an
            <code className="mx-1 text-xs">email</code> column. Existing contacts are updated,
            not duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <input
              id="csv-file"
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="text-muted-foreground file:bg-muted file:text-foreground hover:file:bg-accent w-full cursor-pointer rounded-md border p-2 text-sm file:mr-3 file:cursor-pointer file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="csv-text">Or paste CSV</Label>
            <Textarea
              id="csv-text"
              rows={9}
              value={csv}
              placeholder={SAMPLE}
              onChange={(event) => setCsv(event.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || csv.trim().length === 0}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
