import { after, NextResponse } from "next/server";

import { runCampaignSends, SEND_BUDGET_MS } from "@/lib/campaign-sender";
import { checkReplies } from "@/lib/replies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reply checks go first and are quick; sending gets the rest of the budget. */
const REPLY_BUDGET_MS = 45_000;

/**
 * Background campaign sender. Point a scheduler at this every 5–10 minutes
 * with `Authorization: Bearer $CRON_SECRET` — each call records new replies
 * (and notifies about them), then sends a small batch for every campaign that
 * is currently sending.
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
    const startedAt = Date.now();

    try {
      const replies = await checkReplies({ deadline: startedAt + REPLY_BUDGET_MS });
      console.log("[cron/campaigns] replies", JSON.stringify(replies));
    } catch (error) {
      console.error("[cron/campaigns] reply check failed", error);
    }

    try {
      const result = await runCampaignSends(SEND_BUDGET_MS - (Date.now() - startedAt));
      console.log("[cron/campaigns] sends", JSON.stringify(result));
    } catch (error) {
      console.error("[cron/campaigns] run failed", error);
    }
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
