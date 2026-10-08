import { NextResponse } from "next/server";
import { LATE_FEE, SERVICES, SHOP } from "@/lib/config";
import { fmtTime } from "@/lib/slots";
import { ukMobile } from "@/lib/sms";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";
import { freeSlots } from "@/lib/taken";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const service = SERVICES.find((s) => s.id === body.serviceId);
  if (!service) return bad("Choose a service.");
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) return bad("Add your name.");
  const phone = ukMobile(String(body.phone || ""));
  if (!phone) return bad("Enter a UK mobile number, like 07700 900123.");

  const slot = new Date(body.slot);
  const free = await freeSlots();
  if (!free.some((s) => s.getTime() === slot.getTime())) {
    return bad("That time has just gone. Pick another slot.");
  }

  const total = service.price + LATE_FEE;
  const { data: booking, error } = await db()
    .from("bookings")
    .insert({
      name, phone,
      service_id: service.id, service_name: service.name,
      slot_at: slot.toISOString(),
      service_price: service.price, late_fee: LATE_FEE, total,
      status: "pending",
    })
    .select()
    .single();
  // A unique-index clash means someone grabbed the slot a moment ago.
  if (error || !booking) return bad("That time has just gone. Pick another slot.");

  const site = process.env.SITE_URL || new URL(req.url).origin;
  let session: Awaited<ReturnType<ReturnType<typeof stripe>["checkout"]["sessions"]["create"]>>;
  try {
    session = await stripe().checkout.sessions.create({
    mode: "payment",
    currency: "gbp",
    line_items: [
      { quantity: 1, price_data: { currency: "gbp", unit_amount: service.price, product_data: { name: `${service.name} at ${fmtTime(slot)}` } } },
      { quantity: 1, price_data: { currency: "gbp", unit_amount: LATE_FEE, product_data: { name: "Late booking fee (shop opened out of hours)" } } },
    ],
    metadata: { booking_id: booking.id },
    payment_intent_data: { metadata: { booking_id: booking.id }, description: `${SHOP.name} ${fmtTime(slot)}` },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe's minimum; frees the slot if abandoned
    success_url: `${site}/booking/${booking.id}`,
    cancel_url: `${site}/?cancelled=1`,
    });
  } catch (e) {
    console.error("Stripe checkout failed", e);
    await db().from("bookings").update({ status: "expired" }).eq("id", booking.id);
    return NextResponse.json({ error: "Payment couldn't start. Try again in a moment." }, { status: 502 });
  }

  await db().from("bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);
  return NextResponse.json({ url: session.url });
}
