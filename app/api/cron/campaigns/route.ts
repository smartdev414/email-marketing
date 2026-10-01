import { NextResponse } from "next/server";

import { runCampaignSends } from "@/lib/campaign-sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background campaign sender. Point a scheduler at this every 10–15 minutes
 * with `Authorization: Bearer $CRON_SECRET` — each call sends a small batch
 * for every campaign that is currently sending.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCampaignSends();
  return NextResponse.json(result);
}
