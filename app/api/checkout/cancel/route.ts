import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";

// Stripe sends the customer here when they leave Checkout. Expire the session so the slot frees now, not in 30 min.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/?cancelled=1", process.env.SITE_URL || url.origin);
  const id = url.searchParams.get("booking") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(home);

  const { data: b } = await db()
    .from("bookings")
    .select("stripe_session_id")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();

  if (b?.stripe_session_id) {
    try {
      await stripe().checkout.sessions.expire(b.stripe_session_id);
      await db().from("bookings").update({ status: "expired" }).eq("id", id).eq("status", "pending");
    } catch (e) {
      // Already paid or already expired: leave the booking alone, the webhook has it covered.
      console.error(`Couldn't expire checkout for booking ${id}`, e);
    }
  }
  return NextResponse.redirect(home);
}
