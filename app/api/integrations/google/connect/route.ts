import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { MAILBOX_STATE_COOKIE, mailboxConsentUrl } from "@/lib/google";
import { appUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/**
 * Starts the Google consent flow for connecting another Gmail mailbox. A random
 * `state` is kept in a short-lived cookie and checked on the callback so the
 * grant can only be attached to the person who started it.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${appUrl()}/login`);
  }

  const state = randomBytes(24).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set(MAILBOX_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
    path: "/api/integrations/google",
    maxAge: 10 * 60,
  });

  const loginHint = request.nextUrl.searchParams.get("hint") ?? undefined;
  return NextResponse.redirect(mailboxConsentUrl(state, loginHint));
}
