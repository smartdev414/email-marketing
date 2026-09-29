import { NextResponse } from "next/server";

import { unsubscribeByToken } from "@/lib/actions/contacts";
import { unsubscribeUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe. Gmail and Outlook POST here when the reader
 * taps their own "unsubscribe" button, which is a positive deliverability
 * signal. A GET just sends a human to the confirmation page.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await unsubscribeByToken(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ unsubscribed: true });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return NextResponse.redirect(unsubscribeUrl(token), 302);
}
