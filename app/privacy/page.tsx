import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {site.company} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates {site.name}, an email
        outreach tool that lets members of a sales team send campaigns from their own Gmail
        accounts and follow up on replies. This policy explains what data we collect, how we use
        it, and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> your name, email address and profile picture from
          Google when you sign in, and a hashed password if you choose to set one.
        </li>
        <li>
          <strong>Gmail data:</strong> when you connect a Gmail mailbox we receive OAuth tokens
          that let us send email on your behalf and read the threads of messages sent through{" "}
          {site.name}, so we can detect replies and bounce notifications.
        </li>
        <li>
          <strong>Contact and campaign data:</strong> the contacts, templates, campaigns and
          automations you create or import.
        </li>
        <li>
          <strong>Engagement data:</strong> if you turn tracking on for a campaign, we record when
          recipients open emails, click links or unsubscribe.
        </li>
      </ul>

      <h2>How we use Google user data</h2>
      <p>We request the following Google permissions and use them only as described:</p>
      <ul>
        <li>
          <strong>Basic profile and email</strong> (<code>openid</code>, <code>userinfo.email</code>
          , <code>userinfo.profile</code>): to sign you in, identify which mailbox you connected,
          and show your name as the sender.
        </li>
        <li>
          <strong>Gmail</strong> (<code>gmail.modify</code>): to send the campaign and reply emails
          you start, to read replies in those threads so they appear in your {site.name} inbox and
          stop follow-ups, and to find bounce notices so bad addresses are not emailed again.
        </li>
      </ul>
      <p>
        We do not read, store or process emails unrelated to messages sent through {site.name}. We
        never delete email from your mailbox.
      </p>
      <p>
        {site.name}&rsquo;s use and transfer to any other app of information received from Google
        APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="underline"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In particular:
      </p>
      <ul>
        <li>We use Google user data only to provide and improve the features described above.</li>
        <li>We do not sell Google user data or transfer it for advertising or credit decisions.</li>
        <li>
          We do not use Google user data to serve ads, and we do not use it to train generalized
          AI or machine-learning models.
        </li>
        <li>
          No person reads your Gmail data unless you give explicit consent (for example, for
          support), it is needed for security or legal reasons, or the data is aggregated and
          anonymised for internal operations.
        </li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We do not sell personal data. We share it only with service providers that host and run{" "}
        {site.name} (such as our cloud hosting and database providers), under contracts that
        require them to protect it, or when required by law.
      </p>

      <h2>Storage and security</h2>
      <p>
        Data is stored in a managed database and transmitted over HTTPS. OAuth tokens are kept on
        the server and never exposed to the browser. Passwords are stored only as salted hashes.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while your account is active. You can disconnect a mailbox at any time
        on the Integrations page, which deletes its stored tokens, and you can revoke access at{" "}
        <a href="https://myaccount.google.com/permissions" className="underline">
          myaccount.google.com/permissions
        </a>
        . To delete your account and associated data, email{" "}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>{" "}
        and we will do so within 30 days.
      </p>

      <h2>Email recipients</h2>
      <p>
        If you received an email sent through {site.name}, you can unsubscribe with the link in
        that email. We keep your address on a suppression list so you are not contacted again.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy. We will change the date above and, for material changes,
        notify signed-in users.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{" "}
        <a href={`mailto:${site.contactEmail}`} className="underline">
          {site.contactEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
