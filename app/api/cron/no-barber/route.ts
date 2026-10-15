import { NextResponse } from "next/server";
import { chaseUnclaimed } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// Supabase pg_cron calls this every 2 minutes (see supabase/2026-10-15-no-barber-cron.sql).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const result = await chaseUnclaimed();
  if (result.reminded || result.refunded || result.failed) console.log("No-barber check", result);
  return NextResponse.json(result);
}
