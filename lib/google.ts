import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { GOOGLE_SCOPES } from "@/auth.config";
import { MailboxConnectionError } from "@/lib/mailbox";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/tracking";

/** Holds the OAuth `state` between the connect and callback routes. */
export const MAILBOX_STATE_COOKIE = "mailbox_oauth_state";

/** Where Google sends the user back after they approve a mailbox connection. */
export function integrationRedirectUri() {
  return `${appUrl()}/api/integrations/google/callback`;
}

function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    redirectUri,
  });
}

/** Consent URL for connecting an extra Gmail mailbox (not for signing in). */
export function mailboxConsentUrl(state: string, loginHint?: string) {
  return oauthClient(integrationRedirectUri()).generateAuthUrl({
    scope: GOOGLE_SCOPES.split(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token and lets the user pick
    // which of their Google accounts to connect.
    prompt: "consent select_account",
    include_granted_scopes: true,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

/** Swaps the callback `code` for tokens and reads which mailbox was granted. */
export async function exchangeMailboxCode(code: string) {
  const client = oauthClient(integrationRedirectUri());
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get();

  return {
    email: profile.data.email?.toLowerCase() ?? null,
    name: profile.data.name ?? null,
    tokens,
  };
}

/**
 * Builds an OAuth2 client for one connected mailbox. Refreshed tokens are
 * written back so the next send does not have to re-authorise.
 */
export async function getOAuthClient(emailAccountId: string): Promise<OAuth2Client> {
  const mailbox = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });

  if (!mailbox?.accessToken) {
    throw new MailboxConnectionError();
  }

  const client = oauthClient();

  client.setCredentials({
    access_token: mailbox.accessToken,
    refresh_token: mailbox.refreshToken ?? undefined,
    expiry_date: mailbox.expiresAt ? mailbox.expiresAt * 1000 : undefined,
    scope: mailbox.scope ?? undefined,
  });

  client.on("tokens", (tokens) => {
    void prisma.emailAccount
      .update({
        where: { id: mailbox.id },
        data: {
          accessToken: tokens.access_token ?? mailbox.accessToken,
          refreshToken: tokens.refresh_token ?? mailbox.refreshToken,
          expiresAt: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : mailbox.expiresAt,
          scope: tokens.scope ?? mailbox.scope,
          lastError: null,
        },
      })
      .catch((error) => {
        console.error("Failed to persist refreshed Google tokens", error);
      });
  });

  return client;
}

export async function getGmail(emailAccountId: string) {
  const auth = await getOAuthClient(emailAccountId);
  return google.gmail({ version: "v1", auth });
}

/** The Google account's own profile name, used when no From name is set. */
export async function gmailProfileName(emailAccountId: string) {
  const auth = await getOAuthClient(emailAccountId);
  const profile = await google.oauth2({ version: "v2", auth }).userinfo.get();
  return profile.data.name?.trim() || null;
}
