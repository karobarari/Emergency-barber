import { NextResponse } from "next/server";
import { chaseUnclaimed, nudgeUnfinished, openExpiredWindows, remindCustomers } from "@/lib/bookings";
import { reportError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Supabase pg_cron calls this every 2 minutes (see supabase/2026-10-15-cron.sql).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const result: Record<string, unknown> = {};
  // Each job runs even if the other fails, so a stuck refund can't hold up reminders.
  try {
    result.openedToAll = await openExpiredWindows();
  } catch (e) {
    await reportError("Opening requested bookings to all barbers failed", e);
    result.openedToAll = "failed";
  }
  try {
    result.noBarber = await chaseUnclaimed();
  } catch (e) {
    await reportError("No-barber check failed", e);
    result.noBarber = "failed";
  }
  try {
    result.remindersSent = await remindCustomers();
  } catch (e) {
    await reportError("Reminder texts failed", e);
    result.remindersSent = "failed";
  }
  try {
    result.doneNudges = await nudgeUnfinished();
  } catch (e) {
    await reportError("Done nudges failed", e);
    result.doneNudges = "failed";
  }
  return NextResponse.json(result);
}
