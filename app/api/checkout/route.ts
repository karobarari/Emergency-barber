import { NextResponse } from "next/server";
import { blockFor } from "@/lib/capacity";
import { CANCEL_CUTOFF_MINS, CAPACITY, gbp, LATE_GRACE_MINS, OPERATOR, SERVICES, SHOP } from "@/lib/config";
import { quote } from "@/lib/pricing";
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
  const now = new Date();
  const free = await freeSlots(now, { serviceId: service.id });
  if (!free.some((s) => s.getTime() === slot.getTime())) {
    return bad("That time has just gone. Pick another slot.");
  }

  // Priced here, never from the browser, and locked into the card hold.
  const q = quote({ serviceId: service.id, locationType: "shop", slotAt: slot, now });
  // The booking fee goes up as the slot gets closer. If it has since the customer saw it, show them the new total first.
  if (body.expectedTotal !== q.total) {
    return NextResponse.json(
      {
        error: `The booking fee for this time is now ${gbp(q.advanceFee)} (${q.tierLabel}), so the total is ${gbp(q.total)}. Check it and request again.`,
        quote: { fee: q.advanceFee, tierLabel: q.tierLabel },
      },
      { status: 409 },
    );
  }
  // Checks for room and inserts in one locked step, so two customers can't both take the last place.
  const block = blockFor({ locationType: "shop", slotAt: slot, serviceId: service.id });
  const { data: booking, error } = await db().rpc("reserve_booking", {
    p_booking: {
      name, phone,
      service_id: service.id, service_name: service.name,
      slot_at: slot.toISOString(),
      location_type: block.locationType, block_start: block.start.toISOString(), block_end: block.end.toISOString(),
      service_price: q.servicePrice, advance_fee: q.advanceFee, price_tier: q.tier, total: q.total,
      status: "pending",
      terms_accepted_at: new Date().toISOString(),
    },
    p_barber_count: CAPACITY.barberCount,
    p_shop_chairs: CAPACITY.shopChairs,
  });
  // EBFUL: someone took the last place a moment ago.
  if (error?.code === "EBFUL") return bad("That time has just gone. Pick another slot.");
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
    // Holds only work on cards (Apple Pay and Google Pay count as cards), not delayed methods like Bacs.
    payment_method_types: ["card"],
    submit_type: "book",
    line_items: [
      { quantity: 1, price_data: { currency: "gbp", unit_amount: q.servicePrice, product_data: { name: `${service.name} at ${fmtTime(slot)} on ${fmtDay(slot)}` } } },
      { quantity: 1, price_data: { currency: "gbp", unit_amount: q.advanceFee, product_data: { name: `Booking fee (${q.tierLabel})` } } },
    ],
    metadata: { booking_id: booking.id },
    payment_intent_data: {
      metadata: { booking_id: booking.id },
      // Only hold the money. It's charged when a barber taps Assign, and released if nobody does.
      // Stripe can't make a post-payment invoice for a hold, so the receipt emailed on capture is the confirmation
      // and carries the details from this description.
      capture_method: "manual",
      description: `${service.name} at ${fmtTime(slot)} on ${fmtDay(slot)}, ${SHOP.name}, ${SHOP.address}. Track or cancel: ${site}/booking/${booking.id}. ${OPERATOR.trading} is run by ${OPERATOR.name}, sole trader, ${OPERATOR.email}.`,
    },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe's minimum; frees the slot if abandoned
    custom_text: {
      submit: {
        message: `We hold this on your card and only charge it when a barber accepts. If nobody can, the hold is released. Cancel free until a barber confirms. After that the ${gbp(q.advanceFee)} booking fee is kept, nothing is refunded within ${CANCEL_CUTOFF_MINS} min, and the barber may leave if you are over ${LATE_GRACE_MINS} min late.`,
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
