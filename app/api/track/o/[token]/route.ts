import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 1x1 transparent PNG.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFbeqEAAAAASUVORK5CYII=",
  "base64",
);

function pixelResponse() {
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(PIXEL.byteLength),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params;
  const token = rawToken.replace(/\.(png|gif|jpg)$/i, "");

  try {
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { trackingToken: token },
      select: { id: true, sentAt: true, firstOpenedAt: true, status: true },
    });

    // Unknown token, or the sender's own client loading the draft.
    if (!recipient?.sentAt) return pixelResponse();
    if (Date.now() - recipient.sentAt.getTime() < 5_000) return pixelResponse();

    const now = new Date();

    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          openCount: { increment: 1 },
          lastOpenedAt: now,
          ...(recipient.firstOpenedAt ? {} : { firstOpenedAt: now }),
          // A reply is a stronger signal than an open, so never downgrade it.
          ...(recipient.status === "SENT" ? { status: "OPENED" as const } : {}),
        },
      }),
      prisma.emailEvent.create({
        data: {
          recipientId: recipient.id,
          type: "OPEN",
          userAgent: request.headers.get("user-agent"),
          ipAddress:
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        },
      }),
    ]);
  } catch (error) {
    // Tracking must never break the email — log and still return the pixel.
    console.error("Open tracking failed", error);
  }

  return pixelResponse();
}
