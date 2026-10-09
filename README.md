# Outreach — Email Marketing Platform

Cold-outreach platform for a sales team. Campaigns go out from each team member's
own Gmail, so replies land in their real inbox. Opens, clicks and replies are
tracked; templates and follow-up automations are managed in the app.

Built with **Next.js 16** (App Router), **React 19**, **Tailwind CSS v4**,
**shadcn/ui**, **Prisma 7** on **PostgreSQL**, and **Auth.js v5** with Google
OAuth.

---

## What it does

| Area | What you get |
| --- | --- |
| **Auth** | Google OAuth only. Optional allowlist by email or domain. First person to sign in becomes admin. |
| **Contacts** | The working set campaigns draw from. Pull a random batch out of the `hl_contacts` warehouse, import a CSV, or add one by hand. |
| **Templates** | Subject + body with `{{firstName}}`-style variables, live preview, and a deliverability linter. |
| **Campaigns** | Pick a template, draw *N* contacts at random, then release the audience in batches. Per-campaign open/click tracking toggles. |
| **Tracking** | Open pixel, click redirect, and reply detection by reading your own Gmail threads. |
| **Inbox** | Everyone who replied, with a reply box that answers inside the original thread. |
| **Automations** | "No reply after N days", "opened but never replied", "always follow up". Fires once per contact, in-thread. |
| **Spam prevention** | Daily per-mailbox cap, randomised pacing, address screening, suppression list, one-click unsubscribe, content linting. |

---

## Getting started

```bash
npm install
cp .env.example .env     # then fill it in — see below
npm run db:deploy        # create the tables
npm run db:seed          # optional: 3 starter templates + 2 paused automations
npm run dev
```

Open <http://localhost:3000> and sign in with Google.

### Environment

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `AUTH_SECRET` | Generate with `npx auth secret`. |
| `AUTH_URL` | `http://localhost:3000` locally, your real origin in production. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From the Google Cloud OAuth client. |
| `AUTH_MICROSOFT_ID` / `AUTH_MICROSOFT_SECRET` | Optional. From the Microsoft Entra app registration; enables **Connect Outlook**. |
| `BLOB_READ_WRITE_TOKEN` | Optional. Vercel Blob store token; enables **Insert image** in templates. Vercel adds it when you connect a Blob store to the project. |
| `NEXT_PUBLIC_APP_URL` | Public origin of the app. |
| `NEXT_PUBLIC_TRACKING_URL` | Dedicated tracking subdomain, e.g. `https://t.yourdomain.com`. Falls back to `NEXT_PUBLIC_APP_URL`. |
| `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAIN` | Sign-in allowlist. Leave blank to allow any Google account. |
| `DAILY_SEND_LIMIT` | Per-mailbox daily cap. Default `50`. |
| `MIN_SEND_GAP_MS` / `MAX_SEND_GAP_MS` | Randomised pause between sends. |
| `CRON_SECRET` | Bearer token for `/api/cron/automations` and `/api/cron/campaigns`. |
| `CRON_SENDS_PER_RUN` | Emails each campaign releases per background run. Default `5`. |
| `OPENAI_API_KEY` | Turns on AI variations on the campaign page. Leave blank to send templates as written. |
| `OPENAI_MODEL` | Model for AI variations. Default `gpt-5-nano`. |
| `SEND_TIMEZONE` / `SEND_START_HOUR` / `SEND_END_HOUR` / `SEND_DAYS` | Sending window. Default `America/New_York`, `9`–`20` (9:00 AM–8:00 PM), `1,2,3,4,5` (Mon–Fri). Daily mailbox limits reset at midnight in this zone. |

---

## Google Cloud setup

**1. Enable the Gmail API** — *APIs & Services → Library → Gmail API → Enable*.

**2. OAuth consent screen.** If only your own Workspace mailboxes will use this,
set the app to **Internal**. Internal apps skip Google's verification review
entirely, which matters because the Gmail scopes below are *restricted*.

**3. Scopes** — add exactly these four:

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/gmail.modify
```

`gmail.modify` is all the Gmail access needed: it covers sending
(`messages.send`) as well as reading threads, so the platform can detect replies
and spot mailer-daemon bounce notices. A separate `gmail.send` is redundant
alongside it.

`gmail.modify` is a *restricted* scope. That is fine for an **Internal** app on
your own Workspace, but an **External** app connecting other people's Gmail needs
a CASA security assessment before it can leave testing.

The app checks what a grant lets it *do* rather than matching scope strings, so
`gmail.readonly` + `gmail.send`, or `mail.google.com`, work equally well if you
change the consent screen later. Settings shows exactly which capabilities the
current grant provides.

**4. Authorised redirect URI:**

```
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/integrations/google/callback
https://your-domain.com/api/auth/callback/google
https://your-domain.com/api/integrations/google/callback
```

The second pair is for **Integrations → Connect Gmail account**, which adds
extra sending mailboxes. While the consent screen is in *Testing*, every
mailbox you connect must be listed as a test user.

**5. Authorised JavaScript origin:** `http://localhost:3000` (and your domain).

### Microsoft (Outlook) setup — optional

Outlook.com and Microsoft 365 mailboxes connect through Microsoft Graph.

1. **Microsoft Entra admin center → App registrations → New registration.**
   Supported account types: *Accounts in any organizational directory and
   personal Microsoft accounts*.
2. **Redirect URI** (platform **Web**):
   ```
   http://localhost:3000/api/integrations/microsoft/callback
   https://your-domain.com/api/integrations/microsoft/callback
   ```
3. **Certificates & secrets → New client secret.** Copy the *value* into
   `AUTH_MICROSOFT_SECRET`, and the *Application (client) ID* into
   `AUTH_MICROSOFT_ID`. Secrets expire — note the date.
4. **API permissions → Microsoft Graph → Delegated:** `openid`, `profile`,
   `email`, `offline_access`, `User.Read`, `Mail.Send`, `Mail.ReadWrite`.
   (`Mail.ReadWrite` is required: every email is created as a draft, then sent.)

No Microsoft review is needed to start. Some work tenants only let users
approve apps from a verified publisher; for those, complete
[publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview)
or have their admin grant consent.

---

## Loading the `hl_contacts` warehouse

`hl_contacts` mirrors the GoHighLevel export column-for-column, so the dump's
`INSERT` statements run unchanged. The app only ever **reads** it.

```bash
# 1. Create the schema (table has just its primary key — deliberately).
npm run db:deploy

# 2. Load the dump. 50M rows, so let it run.
psql "$DATABASE_URL" -f hl_contacts.sql

# 3. NOW add the indexes. Doing this before the load makes it several times slower.
npm run db:index-warehouse
```

Then in the app: **Contacts → Pull from warehouse**. That copies every sendable
row into the `Contact` working set (or up to an optional maximum), screening out
role mailboxes, disposable domains, spam rows and anything already unsubscribed
or bounced, and skipping rows already pulled in.

**Why two tables?** You never campaign to 50M rows. The warehouse stays raw and
reloadable; `Contact` holds the few thousand you are actually working, along with
their status. Nothing in the warehouse gets mutated, and a re-import can't
resurrect someone who unsubscribed — the suppression list outlives both.

The pull walks `hl_contacts` in primary-key order in 5,000-row chunks. Each
server call works for about 20 seconds and returns a cursor, and the dialog keeps
calling until the table is drained — so it never hits a function timeout, and
you can stop it and resume later.

---

## Sending a campaign

1. **Integrations** → connect one or more Gmail accounts. The account you sign
   in with is added automatically the first time.
2. **Templates** → write the email. Watch the deliverability panel.
3. **Campaigns → New campaign** → pick the template, tick the mailboxes to send
   from, set how many contacts to draw, choose a batch size. Sends rotate
   round-robin across the ticked mailboxes, each capped at its own daily limit.
4. Open the campaign → **Send next N**. Repeat to walk the audience. Each request
   stays short, and the daily cap stops you before Gmail does.
5. **Check replies** on the campaign, or **Sync Gmail** in the inbox.

Sending is deliberately manual per batch. Nothing goes out on a timer that you
did not click.

---

## Spam prevention

Built in, applied to every send:

- **Daily cap** per mailbox (`DAILY_SEND_LIMIT`, default 50). Cold outreach lives
  or dies on volume discipline.
- **Randomised pacing** of 4–12s between sends.
- **Address screening** — role mailboxes (`info@`, `support@`, `noreply@`…),
  disposable domains, malformed addresses. Rejected on import *and* re-checked at
  send time.
- **Suppression list** — unsubscribes and hard bounces are blocked permanently.
- **One-click unsubscribe** — RFC 8058 `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers plus a footer link.
- **No double-contact** — unique per campaign, and campaigns can exclude anyone
  already emailed by any campaign.
- **Content linting** — spam-trigger wording, shouty subjects, too many links,
  embedded images.
- **Open tracking off by default** — pixels and rewritten links are themselves
  spam signals on a first touch.
- **Bounce sync** — reads mailer-daemon notices out of Gmail, marks the recipient
  bounced and suppresses the address.

Outside the app, you still need: SPF, DKIM and DMARC on the sending domain; a
2–3 week mailbox warm-up; a separate domain from your main one; and a dedicated
tracking subdomain.

### What Gmail can and cannot tell you

The Gmail API handles **sending**, and lets you read **replies** (by `threadId`)
and **bounces** (mailer-daemon messages). It has no concept of "the recipient
opened this" and no per-recipient spam-placement signal — those are not endpoints
that exist. So:

- **Opens and clicks** are built here: a 1×1 pixel route and a logging redirect.
  Both are approximations — Apple Mail Privacy Protection auto-loads pixels
  (false opens) and Gmail's image proxy caches them (missed repeat opens).
- **Spam placement** has no per-recipient API. Google Postmaster Tools gives
  aggregate domain reputation once you send a few hundred a day; seed testing is
  the only way to see actual inbox placement.

Replies are the metric to trust.

---

## Background sending

Once a campaign is started (first "Send next batch" click, or Resume), it keeps
sending on its own: `/api/cron/campaigns` releases `CRON_SENDS_PER_RUN` emails
per sending campaign on every call, still bounded by each mailbox's daily limit.
Pause the campaign to stop it. Nothing — manual or background — goes out
outside the sending window (weekdays 9:00–20:00 US Eastern by default).

`.github/workflows/campaign-sender.yml` calls the endpoint every 10 minutes
(Vercel Hobby only allows daily crons). Add two repository secrets for it:
`APP_URL` (the production origin) and `CRON_SECRET` (same value as on Vercel).

---

## Automations

Create a rule, leave it paused, turn it on when you are happy with it. Then run
it on a schedule — either the HTTP endpoint:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain.com/api/cron/automations
```

or the script, if you would rather not expose it:

```bash
0 9 * * *  cd /path/to/app && npm run automations:run
```

---

## Deployment (Vercel)

Live: see the Vercel project's Domains page (the old `email-marketing-platform-azure.vercel.app` alias no longer resolves).

The project is linked to the Vercel project `email-marketing-platform` under the
`the-agency-engineer` team. `vercel.json` makes each build run
`prisma generate && prisma migrate deploy && next build --webpack`, so schema
changes ship with the code.

A daily cron is registered at **09:00 UTC** against `/api/cron/automations`.
Vercel sends `Authorization: Bearer $CRON_SECRET` automatically because an env
var with that exact name exists — no extra wiring.

### Environment variables on Vercel

Set for production, preview and development:

`DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `AUTH_MICROSOFT_ID`, `AUTH_MICROSOFT_SECRET`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `ALLOWED_EMAILS`, `DAILY_SEND_LIMIT`,
`MIN_SEND_GAP_MS`, `MAX_SEND_GAP_MS`.

`AUTH_URL` and `NEXT_PUBLIC_APP_URL` are deliberately **not** set:
`AUTH_TRUST_HOST=true` lets Auth.js infer the origin, and `appUrl()` falls back
to `VERCEL_PROJECT_PRODUCTION_URL`. Set `NEXT_PUBLIC_TRACKING_URL` once you have
a real tracking subdomain.

To change one:

```bash
vercel env rm  ALLOWED_EMAILS production
vercel env add ALLOWED_EMAILS production
vercel deploy --prod    # NEXT_PUBLIC_* vars are baked in at build time
```

### Auto-deploy on push to main

Needs the Vercel GitHub App to have access to this repository. It is currently
installed on the `smartdev414` GitHub account, while the repo lives under
`smart-ai-414`, so Vercel cannot see it yet. To fix:

1. Open <https://github.com/apps/vercel/installations/new>
2. Choose the **smart-ai-414** account
3. Grant access to **email-marketing-platform** (or all repositories)
4. Then run:

```bash
vercel git connect https://github.com/smart-ai-414/email-marketing-platform.git
```

Until then, deploy with `vercel deploy --prod`.

### Google OAuth redirect URI

Add the production callback to the OAuth client, or sign-in will fail with
`redirect_uri_mismatch`:

```
https://email-marketing-platform-azure.vercel.app/api/auth/callback/google
https://email-marketing-platform-azure.vercel.app/api/integrations/google/callback
```

Authorised JavaScript origin: `https://email-marketing-platform-azure.vercel.app`

---

## Project layout

```
app/
  (app)/              signed-in shell — dashboard, contacts, templates,
                      campaigns, inbox, automations, settings
  api/auth/           Auth.js handlers
  api/track/o|c/      open pixel + click redirect
  api/unsubscribe/    RFC 8058 one-click endpoint
  api/cron/           automation runner
  login/              Google sign-in
  unsubscribe/        human-facing confirmation page
components/           UI — ui/ is shadcn, the rest is this app
lib/
  actions/            server actions (contacts, templates, campaigns,
                      automations, warehouse, auth)
  deliverability.ts   pure spam-prevention checks (safe in client components)
  suppression.ts      block list + daily quota (database-backed)
  mailer.ts           Gmail MIME send, reply and bounce reading
  tracking.ts         pixel/click/unsubscribe URLs, HTML wrapping
  template.ts         {{variable}} rendering
  stats.ts            dashboard and campaign counters
prisma/
  schema.prisma       hl_contacts warehouse + app tables
  sql/                optional warehouse indexes (run after loading)
  seed.mts            starter templates and automations
auth.ts               full Auth.js config (Prisma adapter)
auth.config.ts        edge-safe half, used by proxy.ts
proxy.ts              route protection (Next 16's middleware replacement)
```

---

## Notes

- `npm run build` uses webpack. Turbopack's persistent cache needs to rename
  files inside `.next/cache`, which fails on this machine (`EPERM`/`EBUSY` —
  something scans new files as they appear). `npm run build:turbo` is there if
  that gets fixed.
- Prisma 7 generates its client into `lib/generated/prisma` (gitignored) and
  needs a driver adapter — see `lib/prisma.ts`. Run `npm run db:generate` after
  pulling schema changes.
- Sessions are JWT-backed so `proxy.ts` can run on the edge, while the Prisma
  adapter still persists Google tokens on the `Account` row.
