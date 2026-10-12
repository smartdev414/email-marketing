"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { connectSmtpMailbox } from "@/lib/actions/integrations";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Server settings filled in when a provider is picked; "other" leaves them blank. */
const PRESETS = {
  namecheap: {
    label: "Namecheap Private Email",
    smtpHost: "mail.privateemail.com",
    smtpPort: "465",
    imapHost: "mail.privateemail.com",
    imapPort: "993",
  },
  other: { label: "Other provider", smtpHost: "", smtpPort: "465", imapHost: "", imapPort: "993" },
};

type Preset = keyof typeof PRESETS;

type Props = {
  /** Set when reconnecting: the address is fixed and the servers prefilled. */
  mailbox?: {
    email: string;
    fromName: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    imapHost: string | null;
    imapPort: number | null;
  };
  size?: "sm";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function initialValues(mailbox: Props["mailbox"]) {
  if (!mailbox?.smtpHost) {
    return {
      preset: "namecheap" as Preset,
      fromName: mailbox?.fromName ?? "",
      ...PRESETS.namecheap,
    };
  }
  const servers = {
    smtpHost: mailbox.smtpHost,
    smtpPort: String(mailbox.smtpPort ?? 465),
    imapHost: mailbox.imapHost ?? "",
    imapPort: String(mailbox.imapPort ?? 993),
  };
  const preset: Preset = servers.smtpHost === PRESETS.namecheap.smtpHost ? "namecheap" : "other";
  return { preset, fromName: mailbox.fromName ?? "", ...servers };
}

export function SmtpConnectDialog({ mailbox, size, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [email, setEmail] = useState(mailbox?.email ?? "");
  const [password, setPassword] = useState("");
  const [values, setValues] = useState(() => initialValues(mailbox));

  function field(key: "fromName" | "smtpHost" | "smtpPort" | "imapHost" | "imapPort") {
    return {
      value: values[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  function choosePreset(preset: Preset) {
    const { smtpHost, smtpPort, imapHost, imapPort } = PRESETS[preset];
    setValues((current) => ({ ...current, smtpHost, smtpPort, imapHost, imapPort, preset }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await connectSmtpMailbox({
        email,
        password,
        fromName: values.fromName,
        smtpHost: values.smtpHost,
        smtpPort: Number(values.smtpPort),
        imapHost: values.imapHost,
        imapPort: Number(values.imapPort),
      });

      if (result.ok) {
        toast.success(`${email.trim().toLowerCase()} is connected and ready to send`);
        setPassword("");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {isControlled ? null : (
        <DialogTrigger asChild>
          <Button size={size} variant="outline">
            <Plus className="size-4" />
            Connect other email
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{mailbox ? "Reconnect mailbox" : "Connect other email"}</DialogTitle>
            <DialogDescription>
              Any provider with SMTP and IMAP access, such as Namecheap Private Email. We sign in to
              both servers before saving, so it can take a few seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="smtp-provider">Provider</Label>
              <Select
                value={values.preset}
                onValueChange={(value) => choosePreset(value as Preset)}
              >
                <SelectTrigger id="smtp-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESETS).map(([value, preset]) => (
                    <SelectItem key={value} value={value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtp-email">Email address</Label>
                <Input
                  id="smtp-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="you@yourdomain.com"
                  value={email}
                  readOnly={Boolean(mailbox)}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp-password">Password</Label>
                <Input
                  id="smtp-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="smtp-from-name">From name</Label>
              <Input
                id="smtp-from-name"
                placeholder="Your name"
                maxLength={80}
                {...field("fromName")}
              />
              <p className="text-muted-foreground text-xs">
                Shown to recipients and used for <code>{"{{senderName}}"}</code>.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
              <div className="grid gap-2">
                <Label htmlFor="smtp-host">SMTP server (outgoing)</Label>
                <Input
                  id="smtp-host"
                  required
                  placeholder="smtp.example.com"
                  {...field("smtpHost")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  required
                  min={1}
                  max={65535}
                  {...field("smtpPort")}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
              <div className="grid gap-2">
                <Label htmlFor="imap-host">IMAP server (incoming)</Label>
                <Input
                  id="imap-host"
                  required
                  placeholder="imap.example.com"
                  {...field("imapHost")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="imap-port">Port</Label>
                <Input
                  id="imap-port"
                  type="number"
                  required
                  min={1}
                  max={65535}
                  {...field("imapPort")}
                />
              </div>
            </div>
            <p className="text-muted-foreground -mt-2 text-xs">
              Ports 465 (SMTP) and 993 (IMAP) use SSL; 587 uses STARTTLS. IMAP is how replies and
              bounces are picked up.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Checking…" : mailbox ? "Reconnect" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
