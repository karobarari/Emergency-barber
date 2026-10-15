import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { markPaid } from "@/lib/bookings";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";

// Stripe → Developers → Webhooks: send checkout.session.completed, checkout.session.expired,
// checkout.session.async_payment_succeeded and checkout.session.async_payment_failed here.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature") || "";
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch (e) {
    // A signed request that fails is almost always a wrong STRIPE_WEBHOOK_SECRET, which stops every booking being marked paid.
    if (sig) await reportError("Stripe webhook signature check failed. Is STRIPE_WEBHOOK_SECRET right?", e);
    return new NextResponse("bad signature", { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.booking_id;
  if (!id) return NextResponse.json({ ok: true });

  try {
    // Card payments are "paid" on completion. Delayed methods (e.g. Bacs) complete as "unpaid" and settle later.
    const paid =
      (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded";
    if (paid) {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      await markPaid(id, pi);
    }
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const { error } = await db().from("bookings").update({ status: "expired" }).eq("id", id).eq("status", "pending");
      if (error) throw error;
    }
  } catch (e) {
    await reportError(`Stripe webhook ${event.type} failed for booking ${id}. Stripe will retry`, e);
    return new NextResponse("error", { status: 500 }); // so Stripe retries
  }
  return NextResponse.json({ ok: true });
}
