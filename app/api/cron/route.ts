import { NextResponse } from "next/server";
import { chaseUnclaimed, remindCustomers } from "@/lib/bookings";
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
  return NextResponse.json(result);
}
