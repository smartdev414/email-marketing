import { NextResponse } from "next/server";

import { runAutomations } from "@/lib/actions/automations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Point a scheduler (Vercel Cron, GitHub Actions, cron + curl) at this once a
 * day with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");

  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAutomations();
  return NextResponse.json(result);
}
