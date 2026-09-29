import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { gmailCapabilities } from "@/auth.config";
import { prisma } from "@/lib/prisma";

export class GoogleConnectionError extends Error {
  constructor(message = "Google account is not connected. Sign out and sign in again.") {
    super(message);
    this.name = "GoogleConnectionError";
  }
}

/**
 * Builds an OAuth2 client for a team member from the tokens Auth.js stored on
 * their Google `Account` row. Refreshed tokens are written back so the next
 * send does not have to re-authorise.
 */
export async function getOAuthClient(userId: string): Promise<OAuth2Client> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.access_token) {
    throw new GoogleConnectionError();
  }

  const client = new google.auth.OAuth2({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  });

  client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
    scope: account.scope ?? undefined,
  });

  client.on("tokens", (tokens) => {
    void prisma.account
      .update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token ?? account.access_token,
          refresh_token: tokens.refresh_token ?? account.refresh_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : account.expires_at,
          scope: tokens.scope ?? account.scope,
        },
      })
      .catch((error) => {
        console.error("Failed to persist refreshed Google tokens", error);
      });
  });

  return client;
}

export async function getGmail(userId: string) {
  const auth = await getOAuthClient(userId);
  return google.gmail({ version: "v1", auth });
}

/** True when the stored Google grant lets us send and read, and can be refreshed. */
export async function hasGmailAccess(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true, refresh_token: true },
  });

  const { canSend, canRead } = gmailCapabilities(account?.scope);
  return canSend && canRead && Boolean(account?.refresh_token);
}
