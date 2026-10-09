"use client";

import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  findOrCreateContactList,
  finishContactImport,
  importContactsBatch,
  type ImportBatchResult,
} from "@/lib/actions/contact-lists";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMPORT_BATCH_SIZE,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  guessMapping,
  type ImportField,
  type ImportRow,
} from "@/lib/contact-import";
import { parseContactFile, type ParsedFile } from "@/lib/contact-file";
import { REJECTION_LABELS, type AddressRejection } from "@/lib/deliverability";

export type ContactListOption = { id: string; name: string; size: number };

type Step = "choose" | "map" | "importing" | "done";

type Totals = Omit<ImportBatchResult, "ok">;

const SKIP = "__skip";

const EMPTY_TOTALS: Totals = {
  created: 0,
  updated: 0,
  unchanged: 0,
  duplicates: 0,
  rejected: {},
};

function addTotals(total: Totals, batch: ImportBatchResult): Totals {
  const rejected = { ...total.rejected };
  for (const [reason, count] of Object.entries(batch.rejected)) {
    const key = reason as AddressRejection;
    rejected[key] = (rejected[key] ?? 0) + (count ?? 0);
  }
  return {
    created: total.created + batch.created,
    updated: total.updated + batch.updated,
    unchanged: total.unchanged + batch.unchanged,
    duplicates: total.duplicates + batch.duplicates,
    rejected,
  };
}

/** "Dentists TX (Oct).xlsx" → "Dentists TX (Oct)". */
function nameFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 80);
}

export function ImportContactsDialog({ lists = [] }: { lists?: ContactListOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [reading, setReading] = useState(false);
  const [file, setFile] = useState<{ name: string; data: ParsedFile } | null>(null);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [listName, setListName] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [savedList, setSavedList] = useState<{ name: string; existed: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("choose");
    setFile(null);
    setMapping([]);
    setListName("");
    setProgress({ done: 0, total: 0 });
    setTotals(EMPTY_TOTALS);
    setSavedList(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function onOpenChange(next: boolean) {
    // Closing mid-import would hide the progress; the import itself keeps going.
    if (!next && step === "importing") return;
    setOpen(next);
    if (!next) reset();
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;

    setReading(true);
    try {
      const data = await parseContactFile(chosen);
      if (data.headers.length === 0 || data.rows.length === 0) {
        toast.error("That file has no rows under its header row.");
        return;
      }
      if (data.rows.length > IMPORT_MAX_ROWS) {
        toast.error(
          `That file has ${data.rows.length.toLocaleString()} rows. Split it into files of at most ${IMPORT_MAX_ROWS.toLocaleString()}.`,
        );
        return;
      }
      setFile({ name: chosen.name, data });
      setMapping(guessMapping(data.headers));
      setListName((current) => current || nameFromFile(chosen.name));
      setStep("map");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  /** A field can only be mapped once; picking it again moves it to this column. */
  function mapColumn(column: number, field: ImportField | null) {
    setMapping((current) =>
      current.map((existing, index) => {
        if (index === column) return field;
        return field && existing === field ? null : existing;
      }),
    );
  }

  const emailMapped = mapping.includes("email");
  const mappedColumns = useMemo(
    () =>
      mapping
        .map((field, column) => ({ field, column }))
        .filter((entry): entry is { field: ImportField; column: number } => entry.field !== null),
    [mapping],
  );

  function toRows(data: ParsedFile): ImportRow[] {
    return data.rows.map((cells) => {
      const row: ImportRow = {};
      for (const { field, column } of mappedColumns) {
        const value = cells[column]?.trim();
        if (value) row[field] = value;
      }
      return row;
    });
  }

  async function runImport() {
    if (!file || !emailMapped) return;

    const list = await findOrCreateContactList(listName);
    if (!list.ok) {
      toast.error(list.error);
      return;
    }
    setSavedList({ name: list.name, existed: list.existed });

    const rows = toRows(file.data);
    setStep("importing");
    setProgress({ done: 0, total: rows.length });

    let running = EMPTY_TOTALS;
    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        const result = await importContactsBatch(list.id, batch);
        if (!result.ok) throw new Error(result.error);
        running = addTotals(running, result);
        setTotals(running);
        setProgress({ done: Math.min(start + batch.length, rows.length), total: rows.length });
      } catch (error) {
        toast.error(
          `Stopped after ${start.toLocaleString()} rows: ${error instanceof Error ? error.message : "import failed"}. Re-importing the same file into the same list is safe.`,
        );
        break;
      }
    }

    await finishContactImport();
    router.refresh();
    setStep("done");
  }

  const preview = file?.data.rows.slice(0, 5) ?? [];
  const sample = (column: number) =>
    file?.data.rows.find((row) => row[column]?.trim())?.[column]?.trim() ?? "";
  const skipped =
    totals.duplicates + Object.values(totals.rejected).reduce((sum, count) => sum + (count ?? 0), 0);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="size-4" />
          Import file
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Upload a CSV or Excel (.xlsx) file with a header row. Everyone in it is saved to a contact list a campaign can send to."
              : step === "map"
                ? `${file?.name} · ${file?.data.rows.length.toLocaleString()} rows. Check which column holds what.`
                : step === "importing"
                  ? "Importing — keep this window open."
                  : "Import finished."}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="import-list">Save to list</Label>
              <Input
                id="import-list"
                list="import-list-options"
                placeholder="e.g. Dentists Texas — October (defaults to the file name)"
                value={listName}
                maxLength={80}
                onChange={(event) => setListName(event.target.value)}
              />
              <datalist id="import-list-options">
                {lists.map((list) => (
                  <option key={list.id} value={list.name} />
                ))}
              </datalist>
              <p className="text-muted-foreground text-xs">
                Type a new name, or an existing list&rsquo;s name to add to it.
              </p>
            </div>

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={reading}
              className="hover:bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors"
            >
              {reading ? (
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
              ) : (
                <FileSpreadsheet className="text-muted-foreground size-6" />
              )}
              <span className="text-sm font-medium">
                {reading ? "Reading file…" : "Choose a .csv or .xlsx file"}
              </span>
              <span className="text-muted-foreground text-xs">
                Needs an email column. Name, company, title, phone, country and notes are picked
                up when present. Up to {IMPORT_MAX_ROWS.toLocaleString()} rows.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onFile}
            />
          </div>
        ) : null}

        {step === "map" && file ? (
          <div className="grid max-h-[60dvh] gap-4 overflow-y-auto py-2">
            <div className="grid gap-2">
              <Label htmlFor="import-list-map">Save to list</Label>
              <Input
                id="import-list-map"
                list="import-list-options-map"
                value={listName}
                maxLength={80}
                onChange={(event) => setListName(event.target.value)}
              />
              <datalist id="import-list-options-map">
                {lists.map((list) => (
                  <option key={list.id} value={list.name} />
                ))}
              </datalist>
            </div>

            <div className="rounded-lg border">
              <div className="text-muted-foreground grid grid-cols-[1fr_1fr_11rem] gap-3 border-b px-3 py-2 text-xs font-medium">
                <span>Column in file</span>
                <span>Example</span>
                <span>Import as</span>
              </div>
              {file.data.headers.map((header, column) => (
                <div
                  key={`${header}-${column}`}
                  className="grid grid-cols-[1fr_1fr_11rem] items-center gap-3 border-b px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="truncate font-medium">{header || `Column ${column + 1}`}</span>
                  <span className="text-muted-foreground truncate">{sample(column) || "—"}</span>
                  <Select
                    value={mapping[column] ?? SKIP}
                    onValueChange={(value) =>
                      mapColumn(column, value === SKIP ? null : (value as ImportField))
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>Don&rsquo;t import</SelectItem>
                      {IMPORT_FIELDS.map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {!emailMapped ? (
              <p className="text-destructive text-sm">
                Pick which column holds the email address — it is required.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {mappedColumns.map(({ field }) => (
                        <th key={field} className="px-3 py-1.5 text-left font-medium">
                          {IMPORT_FIELDS.find((option) => option.key === field)?.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((cells, index) => (
                      <tr key={index} className="border-t">
                        {mappedColumns.map(({ field, column }) => (
                          <td key={field} className="max-w-48 truncate px-3 py-1.5">
                            {cells[column] || <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
                  First {preview.length} of {file.data.rows.length.toLocaleString()} rows.
                  Contacts already saved keep their details; only empty fields are filled in.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {step === "importing" ? (
          <div className="grid gap-3 py-6">
            <Progress value={percent} />
            <p className="text-muted-foreground text-center text-sm tabular-nums">
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows · {percent}%
            </p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="grid gap-3 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              {(totals.created + totals.updated + totals.unchanged).toLocaleString()} contacts in
              list &ldquo;{savedList?.name}&rdquo;
              {savedList?.existed ? " (added to the existing list)" : ""}
            </p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>{totals.created.toLocaleString()} new contacts added</li>
              <li>{totals.updated.toLocaleString()} existing contacts had empty fields filled</li>
              <li>{totals.unchanged.toLocaleString()} existing contacts added to the list unchanged</li>
              {skipped > 0 ? (
                <li>
                  {skipped.toLocaleString()} rows skipped:{" "}
                  {[
                    ...Object.entries(totals.rejected).map(
                      ([reason, count]) =>
                        `${count} ${REJECTION_LABELS[reason as AddressRejection]}`,
                    ),
                    ...(totals.duplicates ? [`${totals.duplicates} repeated in the file`] : []),
                  ].join(", ")}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          {step === "map" ? (
            <>
              <Button variant="ghost" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={runImport} disabled={!emailMapped || listName.trim().length < 2}>
                Import {file?.data.rows.length.toLocaleString()} rows
              </Button>
            </>
          ) : step === "done" ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : step === "choose" ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
