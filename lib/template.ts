import type { Contact } from "@/lib/generated/prisma/client";

/** Variables a template author can drop into a subject or body. */
export const TEMPLATE_VARIABLES = [
  { token: "{{firstName}}", label: "First name" },
  { token: "{{lastName}}", label: "Last name" },
  { token: "{{fullName}}", label: "Full name" },
  { token: "{{email}}", label: "Email" },
  { token: "{{company}}", label: "Company" },
  { token: "{{jobTitle}}", label: "Job title" },
  { token: "{{country}}", label: "Country" },
  { token: "{{senderName}}", label: "Your name" },
] as const;

export type ContactLike = Pick<
  Contact,
  "email" | "firstName" | "lastName" | "company" | "jobTitle" | "country"
>;

export function buildVariables(contact: ContactLike, senderName?: string | null) {
  const firstName = contact.firstName?.trim() ?? "";
  const lastName = contact.lastName?.trim() ?? "";

  return {
    firstName: firstName || "there",
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" ") || "there",
    email: contact.email,
    company: contact.company ?? "",
    jobTitle: contact.jobTitle ?? "",
    country: contact.country ?? "",
    senderName: senderName ?? "",
  } satisfies Record<string, string>;
}

/** Replaces `{{token}}` placeholders; unknown tokens are stripped. */
export function renderTemplate(input: string, variables: Record<string, string>) {
  return input.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
}

/** Sample data so authors can preview a template without picking a contact. */
export const PREVIEW_CONTACT: ContactLike = {
  email: "jordan@acme.com",
  firstName: "Jordan",
  lastName: "Lee",
  company: "Acme Inc.",
  jobTitle: "Head of Sales",
  country: "United States",
};
