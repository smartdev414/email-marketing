/**
 * Public details shown on the home, privacy and terms pages. Google's OAuth
 * verification reviewers read these, so they must match the consent screen.
 */
export const site = {
  name: "Outreach",
  company: process.env.NEXT_PUBLIC_COMPANY_NAME || "Outreach",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "support@example.com",
  /** Bump when the privacy policy or terms change. */
  lastUpdated: "September 30, 2026",
};
