import { NextResponse } from "next/server";
import { CANCEL_CUTOFF_MINS, gbp, LATE_FEE, LATE_GRACE_MINS, OPERATOR, SERVICES, SHOP } from "@/lib/config";
import { fmtDay, fmtTime } from "@/lib/slots";
import { ukMobile } from "@/lib/sms";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";
import { freeSlots } from "@/lib/taken";

const bad = (error: string) => {
  console.warn("Checkout rejected:", error);
  return NextResponse.json({ error }, { status: 400 });
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const service = SERVICES.find((s) => s.id === body.serviceId);
  if (!service) return bad("Choose a service.");
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) return bad("Add your name.");
  const phone = ukMobile(String(body.phone || ""));
  if (!phone) return bad("Enter a UK mobile number, like 07700 900123.");
  if (body.agreed !== true) return bad("Tick the box to agree to the cancellation and lateness rules.");

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
      terms_accepted_at: new Date().toISOString(),
    })
    .select()
    .single();
  // A unique-index clash (23505) means someone grabbed the slot a moment ago.
  if (error?.code === "23505") return bad("That time has just gone. Pick another slot.");
  if (error || !booking) {
    await reportError("Booking insert failed", error?.message ?? error);
    return NextResponse.json({ error: "Couldn't save your booking. Try again in a moment." }, { status: 500 });
  }

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
    // Stripe emails a paid invoice (with PDF) to the email entered at checkout.
    // This invoice email doubles as the booking confirmation, so it carries the details and the status link.
    invoice_creation: {
      enabled: true,
      invoice_data: {
        metadata: { booking_id: booking.id },
        description: `${service.name} at ${fmtTime(slot)} on ${fmtDay(slot)}, ${SHOP.name}, ${SHOP.address}. We text you when a barber confirms. Track or cancel: ${site}/booking/${booking.id}`,
        custom_fields: [
          { name: "Booking", value: `${fmtTime(slot)}, ${fmtDay(slot)}` },
          { name: "Where", value: SHOP.name },
        ],
        footer: `${OPERATOR.trading} is run by ${OPERATOR.name}, sole trader. ${OPERATOR.email}. Refund policy: ${site}/refunds`,
      },
    },
    custom_text: {
      submit: {
        message: `Full refund if you cancel before a barber confirms. After that the ${gbp(LATE_FEE)} late fee is kept, nothing is refunded within ${CANCEL_CUTOFF_MINS} min, and the barber may leave if you are over ${LATE_GRACE_MINS} min late.`,
      },
    },
    success_url: `${site}/booking/${booking.id}`,
    cancel_url: `${site}/api/checkout/cancel?booking=${booking.id}`,
    });
  } catch (e) {
    await reportError("Stripe checkout failed to open", e);
    await db().from("bookings").update({ status: "expired" }).eq("id", booking.id);
    return NextResponse.json({ error: "Payment couldn't start. Try again in a moment." }, { status: 502 });
  }

  await db().from("bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);
  return NextResponse.json({ url: session.url });
}
