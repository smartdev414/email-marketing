import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { MICROSOFT_STATE_COOKIE, microsoftConfigured, microsoftConsentUrl } from "@/lib/microsoft";
import { appUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/**
 * Starts the Microsoft consent flow for connecting an Outlook mailbox. Same
 * `state` cookie check as the Google flow, so a grant can only be attached to
 * the person who started it.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${appUrl()}/login`);
  }

  if (!microsoftConfigured()) {
    const query = new URLSearchParams({
      error: "Outlook is not set up yet: AUTH_MICROSOFT_ID and AUTH_MICROSOFT_SECRET are missing.",
    });
    return NextResponse.redirect(`${appUrl()}/integrations?${query.toString()}`);
  }

  const state = randomBytes(24).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set(MICROSOFT_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
    path: "/api/integrations/microsoft",
    maxAge: 10 * 60,
  });

  const loginHint = request.nextUrl.searchParams.get("hint") ?? undefined;
  return NextResponse.redirect(microsoftConsentUrl(state, loginHint));
}
