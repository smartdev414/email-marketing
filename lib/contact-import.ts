/**
 * Contact fields an imported file can fill, and the header names each one is
 * recognised by. Shared by the import dialog (to pre-match columns) and the
 * server action (to know what it may receive). No server-only imports here.
 */

export const IMPORT_FIELDS = [
  { key: "email", label: "Email", required: true },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "company", label: "Company" },
  { key: "jobTitle", label: "Job title" },
  { key: "phone", label: "Phone" },
  { key: "country", label: "Country" },
  { key: "notes", label: "Notes" },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** One parsed row, keyed by contact field. */
export type ImportRow = Partial<Record<ImportField, string>>;

/** Rows sent per server call: well under the 1 MB action limit, quick to save. */
export const IMPORT_BATCH_SIZE = 500;

/** Most rows a single import accepts. */
export const IMPORT_MAX_ROWS = 50_000;

const ALIASES: Record<ImportField, string[]> = {
  email: ["email", "emailaddress", "mail", "workemail", "businessemail", "contactemail"],
  firstName: ["firstname", "first", "givenname", "fname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  company: ["company", "companyname", "organisation", "organization", "account", "business"],
  jobTitle: ["jobtitle", "title", "position", "role"],
  phone: ["phone", "phonenumber", "mobile", "telephone", "tel", "cell"],
  country: ["country", "countryname"],
  notes: ["notes", "note", "comments", "comment"],
};

/** "First Name", "first_name" and "FIRSTNAME" all compare as "firstname"; "E-mail" as "email". */
function normalize(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-guess field for each column header; unrecognised columns map to null. */
export function guessMapping(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return headers.map((header) => {
    const key = normalize(header);
    const field = (Object.keys(ALIASES) as ImportField[]).find(
      (candidate) => !taken.has(candidate) && ALIASES[candidate].includes(key),
    );
    if (!field) return null;
    taken.add(field);
    return field;
  });
}
