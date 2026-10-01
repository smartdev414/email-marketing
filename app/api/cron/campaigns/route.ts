import { after, NextResponse } from "next/server";

import { runCampaignSends } from "@/lib/campaign-sender";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background campaign sender. Point a scheduler at this every 5–10 minutes
 * with `Authorization: Bearer $CRON_SECRET` — each call sends a small batch
 * for every campaign that is currently sending.
 *
 * Replies 202 straight away and sends inside `after()`, because a run paces
 * its emails over minutes and schedulers such as cron-job.org give up after
 * ~30s. The run summary goes to the function logs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await runCampaignSends();
      console.log("[cron/campaigns]", JSON.stringify(result));
    } catch (error) {
      console.error("[cron/campaigns] run failed", error);
    }
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
