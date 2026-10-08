import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { markPaid } from "@/lib/bookings";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";

// Stripe → Developers → Webhooks: send checkout.session.completed and checkout.session.expired here.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature") || "";
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch {
    return new NextResponse("bad signature", { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.booking_id;
  if (!id) return NextResponse.json({ ok: true });

  if (event.type === "checkout.session.completed" && session.payment_status === "paid") {
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
    await markPaid(id, pi);
  }
  if (event.type === "checkout.session.expired") {
    await db().from("bookings").update({ status: "expired" }).eq("id", id).eq("status", "pending");
  }
  return NextResponse.json({ ok: true });
}
