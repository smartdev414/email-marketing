"use client";

import { AlertTriangle, ImagePlus, Info, Loader2, Plus } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { checkContent } from "@/lib/deliverability";

import { createTemplate, updateTemplate, type TemplateInput } from "@/lib/actions/templates";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  PREVIEW_CONTACT,
  TEMPLATE_VARIABLES,
  buildVariables,
  imageToken,
  renderTemplate,
} from "@/lib/template";
import { textToHtml } from "@/lib/tracking";

export type TemplateFormValues = TemplateInput & { id?: string };

type Props = {
  template?: TemplateFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
};

function initialValues(template?: TemplateFormValues): TemplateInput {
  return {
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    description: template?.description ?? "",
  };
}

export function TemplateDialog({ template, open, onOpenChange, trigger }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [values, setValues] = useState<TemplateInput>(() => initialValues(template));

  // The dialog stays mounted between uses, so start from a clean form (or the
  // template's saved values) each time it opens rather than the last draft.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setValues(initialValues(template));
  }

  const warnings = useMemo(
    () => checkContent(values.subject, values.body),
    [values.subject, values.body],
  );

  const variables = buildVariables(PREVIEW_CONTACT, "Alex Morgan");
  const previewSubject = renderTemplate(values.subject || "(no subject)", variables);
  const previewBody = renderTemplate(textToHtml(values.body || "(empty)"), variables);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function insertVariable(token: string) {
    setValues((current) => ({ ...current, body: `${current.body}${token}` }));
  }

  /** Puts an image tag on its own paragraph at the cursor (or the end). */
  function insertImage(url: string) {
    const textarea = bodyRef.current;
    setValues((current) => {
      const at = textarea ? textarea.selectionStart : current.body.length;
      const before = current.body.slice(0, at).replace(/\s+$/, "");
      const after = current.body.slice(at).replace(/^\s+/, "");
      const body = [before, imageToken(url), after].filter(Boolean).join("\n\n");
      return { ...current, body };
    });
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/uploads/template-image", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        toast.error(data.error ?? "Could not upload the image.");
        return;
      }
      insertImage(data.url);
      toast.success("Image added");
    } catch {
      toast.error("Could not upload the image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = template?.id
        ? await updateTemplate(template.id, values)
        : await createTemplate(values);

      if (result.ok) {
        toast.success(template?.id ? "Template updated" : "Template created");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : isControlled ? null : (
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            New template
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{template?.id ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              Write plain text — line breaks become paragraphs. Use variables to personalise
              each email, and Insert image to place a picture where your cursor is.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="write" className="py-4">
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="write" className="space-y-4 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="name">Template name</Label>
                  <Input
                    id="name"
                    required
                    placeholder="Cold intro — SaaS"
                    value={values.name}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Internal note</Label>
                  <Input
                    id="description"
                    placeholder="Optional"
                    value={values.description ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  required
                  placeholder="Quick question about {{company}}"
                  value={values.subject}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, subject: event.target.value }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="body">Body</Label>
                <Textarea
                  id="body"
                  ref={bodyRef}
                  required
                  rows={11}
                  className="max-h-[45dvh] overflow-y-auto"
                  placeholder={"Hi {{firstName}},\n\nI noticed {{company}} is…"}
                  value={values.body}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, body: event.target.value }))
                  }
                />
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadImage(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="size-3.5" />
                    )}
                    {uploading ? "Uploading…" : "Insert image"}
                  </Button>
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <Badge
                      key={variable.token}
                      variant="secondary"
                      asChild
                      className="cursor-pointer font-mono text-xs font-normal"
                    >
                      <button type="button" onClick={() => insertVariable(variable.token)}>
                        {variable.token}
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              {warnings.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium">Deliverability check</p>
                  {warnings.map((warning) => (
                    <p
                      key={warning.message}
                      className="text-muted-foreground flex items-start gap-1.5 text-xs"
                    >
                      {warning.level === "warn" ? (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                      )}
                      {warning.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="preview" className="pt-4">
              <div className="rounded-lg border">
                <div className="bg-muted/50 space-y-1 border-b px-4 py-3">
                  <p className="text-muted-foreground text-xs">Subject</p>
                  <p className="text-sm font-medium">{previewSubject}</p>
                </div>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none px-4 py-4 text-sm leading-relaxed [&_p]:my-2"
                  dangerouslySetInnerHTML={{ __html: previewBody }}
                />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Previewed with sample contact data. A tracking pixel and unsubscribe link are
                added automatically on send.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {pending ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
