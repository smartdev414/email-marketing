import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { gmailCapabilities } from "@/auth.config";
import { MAILBOX_STATE_COOKIE, exchangeMailboxCode } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

function back(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${appUrl()}/integrations?${query}`);
}

function sameState(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Google redirects here after the user approves (or declines) a mailbox. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${appUrl()}/login`);
  }

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expected = cookieStore.get(MAILBOX_STATE_COOKIE)?.value;
  cookieStore.delete({ name: MAILBOX_STATE_COOKIE, path: "/api/integrations/google" });

  const state = params.get("state");
  if (!expected || !state || !sameState(expected, state)) {
    return back({ error: "The connection request expired. Try again." });
  }

  const denied = params.get("error");
  if (denied) {
    return back({
      error: denied === "access_denied" ? "Google access was declined." : `Google said: ${denied}`,
    });
  }

  const code = params.get("code");
  if (!code) return back({ error: "Google did not return an authorisation code." });

  let result: Awaited<ReturnType<typeof exchangeMailboxCode>>;
  try {
    result = await exchangeMailboxCode(code);
  } catch (error) {
    console.error("Mailbox connection failed", error);
    return back({ error: "Could not finish connecting the mailbox. Try again." });
  }

  const { email, name, tokens } = result;
  if (!email || !tokens.access_token) {
    return back({ error: "Google did not share the mailbox address." });
  }

  const { canSend, canRead } = gmailCapabilities(tokens.scope);
  if (!canSend || !canRead) {
    return back({
      error: `${email} was connected without Gmail access. Reconnect and tick every permission.`,
    });
  }

  const existing = await prisma.emailAccount.findUnique({
    where: { userId_email: { userId: session.user.id, email } },
    select: { refreshToken: true, fromName: true },
  });

  // Google only sends a refresh token on first consent; keep the old one if
  // this is a reconnect that did not include a new one.
  const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? null;
  if (!refreshToken) {
    return back({
      error: `No refresh token for ${email}. Remove the app at myaccount.google.com/permissions and connect again.`,
    });
  }

  const data = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
    scope: tokens.scope ?? null,
    lastError: null,
  };

  await prisma.emailAccount.upsert({
    where: { userId_email: { userId: session.user.id, email } },
    // Send as the Gmail account's own name unless a custom one was set.
    update: { ...data, isActive: true, fromName: existing?.fromName ?? name },
    create: { ...data, userId: session.user.id, email, provider: "google", fromName: name },
  });

  return back({ connected: email });
}
