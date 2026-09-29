import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const target = new URL(request.url).searchParams.get("u");

  // Only ever redirect to an absolute http(s) URL we were given.
  let destination = appUrl();
  if (target) {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        destination = parsed.toString();
      }
    } catch {
      // Malformed target — fall through to the app URL.
    }
  }

  try {
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { trackingToken: token },
      select: { id: true, firstClickedAt: true },
    });

    if (recipient) {
      const now = new Date();
      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            clickCount: { increment: 1 },
            ...(recipient.firstClickedAt ? {} : { firstClickedAt: now }),
          },
        }),
        prisma.emailEvent.create({
          data: {
            recipientId: recipient.id,
            type: "CLICK",
            url: destination,
            userAgent: request.headers.get("user-agent"),
          },
        }),
      ]);
    }
  } catch (error) {
    console.error("Click tracking failed", error);
  }

  return NextResponse.redirect(destination, 302);
}
