import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of {site.name}, operated by {site.company}. By signing in you
        agree to them. If you do not agree, do not use the service.
      </p>

      <h2>The service</h2>
      <p>
        {site.name} lets authorised team members send email campaigns from their own Gmail
        accounts, track engagement and manage replies. Access is limited to people your
        organisation has approved.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for activity under your account and for keeping your password and
        Google account secure. Tell us promptly at{" "}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>{" "}
        if you suspect unauthorised use.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use {site.name} to:</p>
      <ul>
        <li>send spam, or email people who have not got a lawful basis to be contacted;</li>
        <li>
          break anti-spam and privacy laws such as CAN-SPAM, GDPR, PECR or CASL, or Google&rsquo;s
          Gmail Program Policies;
        </li>
        <li>send deceptive, harassing, illegal or malicious content, including malware or phishing;</li>
        <li>import contact lists you do not have the right to use;</li>
        <li>interfere with, probe or overload the service.</li>
      </ul>
      <p>
        {site.name} applies sending limits, an unsubscribe link and a suppression list to every
        campaign. You must not try to get around them.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of the contacts, templates and messages you add. You give us permission
        to store and process them only to run the service for you. How we handle data is described
        in our <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>

      <h2>Google account access</h2>
      <p>
        When you connect Gmail you authorise {site.name} to send and read email as described in the
        Privacy Policy. You can disconnect a mailbox in the app or revoke access in your Google
        account at any time; campaigns using that mailbox will stop sending.
      </p>

      <h2>Suspension and termination</h2>
      <p>
        We may suspend or end access if you break these terms or put the service, our users or
        email recipients at risk. You may stop using the service at any time.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; without warranties of any kind. We do not
        guarantee that email will be delivered, reach the inbox or receive a response.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, {site.company} is not liable for indirect, incidental or
        consequential damages, or for lost profits or data, arising from your use of the service.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We will change the date above, and continued use after a change
        means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>
      </p>
    </LegalPage>
  );
}
