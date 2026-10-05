import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { outlookCapabilities } from "@/lib/mailbox";
import { MICROSOFT_STATE_COOKIE, exchangeMicrosoftCode } from "@/lib/microsoft";
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

/** Microsoft redirects here after the user approves (or declines) a mailbox. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${appUrl()}/login`);
  }

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expected = cookieStore.get(MICROSOFT_STATE_COOKIE)?.value;
  cookieStore.delete({ name: MICROSOFT_STATE_COOKIE, path: "/api/integrations/microsoft" });

  const state = params.get("state");
  if (!expected || !state || !sameState(expected, state)) {
    return back({ error: "The connection request expired. Try again." });
  }

  const denied = params.get("error");
  if (denied) {
    const description = params.get("error_description")?.split(/\r?\n/)[0];
    return back({
      error:
        denied === "access_denied"
          ? "Microsoft access was declined."
          : // Work tenants that only allow admin-approved apps land here.
            `Microsoft said: ${description || denied}`,
    });
  }

  const code = params.get("code");
  if (!code) return back({ error: "Microsoft did not return an authorisation code." });

  let result: Awaited<ReturnType<typeof exchangeMicrosoftCode>>;
  try {
    result = await exchangeMicrosoftCode(code);
  } catch (error) {
    console.error("Outlook mailbox connection failed", error);
    return back({ error: "Could not finish connecting the mailbox. Try again." });
  }

  const { email, name, tokens } = result;
  if (!email || !tokens.access_token) {
    return back({ error: "Microsoft did not share the mailbox address." });
  }

  const { canSend, canRead } = outlookCapabilities(tokens.scope);
  if (!canSend || !canRead) {
    return back({
      error: `${email} was connected without mail access. Reconnect and accept every permission.`,
    });
  }

  const existing = await prisma.emailAccount.findUnique({
    where: { userId_email: { userId: session.user.id, email } },
    select: { provider: true, refreshToken: true, fromName: true },
  });

  if (existing && existing.provider !== "microsoft") {
    return back({ error: `${email} is already connected as a Gmail mailbox.` });
  }

  const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? null;
  if (!refreshToken) {
    return back({ error: `Microsoft did not return a refresh token for ${email}. Try again.` });
  }

  const data = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    scope: tokens.scope ?? null,
    lastError: null,
  };

  await prisma.emailAccount.upsert({
    where: { userId_email: { userId: session.user.id, email } },
    // Send as the Microsoft account's own name unless a custom one was set.
    update: { ...data, isActive: true, fromName: existing?.fromName ?? name },
    create: { ...data, userId: session.user.id, email, provider: "microsoft", fromName: name },
  });

  return back({ connected: email });
}
