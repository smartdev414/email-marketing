import type { AutomationTrigger } from "@/lib/generated/prisma/enums";

export const TRIGGER_OPTIONS: { value: AutomationTrigger; label: string; hint: string }[] = [
  {
    value: "NO_REPLY_AFTER_DAYS",
    label: "No reply after X days",
    hint: "Follow up when the contact has not answered.",
  },
  {
    value: "OPENED_NO_REPLY",
    label: "Opened but never replied",
    hint: "Nudge the warm contacts who read the email.",
  },
  {
    value: "AFTER_SEND",
    label: "Always follow up",
    hint: "Send a second touch to everyone, reply or not.",
  },
];

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = Object.fromEntries(
  TRIGGER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<AutomationTrigger, string>;
