import { NextResponse } from "next/server";
import { blockFor } from "@/lib/capacity";
import { barbers, CANCEL_CUTOFF_MINS, CAPACITY, gbp, LATE_GRACE_MINS, OPERATOR, SERVICES, SHOP } from "@/lib/config";
import { homeArea } from "@/lib/homeArea";
import { getHotel, hotelTrip } from "@/lib/hotels";
import { quote } from "@/lib/pricing";
import { fmtDay, fmtTime } from "@/lib/slots";
import { ukMobile } from "@/lib/sms";
import { stripe } from "@/lib/stripe";
import { db, type Hotel } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";
import { freeSlots } from "@/lib/taken";

const bad = (error: string, status = 400) => {
  console.warn("Checkout rejected:", error);
  return NextResponse.json({ error }, { status });
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const service = SERVICES.find((s) => s.id === body.serviceId);
  if (!service) return bad("Choose a service.");
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) return bad("Add your name.");
  if (body.agreed !== true) return bad("Tick the box to agree to the cancellation and lateness rules.");
  // null means no preference, and then any barber is fine.
  const preferred = body.preferredBarber == null ? null : barbers().find((n) => n === body.preferredBarber);
  if (preferred === undefined) return bad("Pick a barber from the list, or no preference.");
  const allowFallback = preferred ? body.allowFallback !== false : true;

  const home = body.locationType === "home";
  let phone: string | null;
  let visit: { address: string; postcode: string; lat: number | null; lng: number | null; drive_minutes: number; drive_miles: number } | null = null;
  let hotel: Hotel | null = null;
  let hotelFields = {};
  // For hotels, the booking is in the guest's name and the texts go to the concierge who booked.
  let bookingName = name;
  if (body.locationType === "hotel") {
    hotel = await getHotel(String(body.hotel || ""));
    if (!hotel) return bad("This booking link isn't active. Contact us to book.", 404);
    phone = ukMobile(String(body.phone || ""));
    if (!phone) return bad("Enter a UK mobile number for the concierge, like 07700 900123.");
    const guest = String(body.guestName || "").trim().slice(0, 80);
    const room = String(body.room || "").trim().slice(0, 20);
    if (!guest) return bad("Add the guest's name.");
    if (!room) return bad("Add the guest's room number.");
    bookingName = guest;
    visit = {
      address: `${hotel.name}, ${hotel.address}`, postcode: hotel.postcode, lat: hotel.lat, lng: hotel.lng,
      drive_minutes: hotel.drive_minutes!, drive_miles: Number(hotel.drive_miles),
    };
    hotelFields = { hotel_id: hotel.id, guest_name: guest, room, booker_name: name, booker_phone: phone };
  } else if (home) {
    // Never from the browser: the phone is the one verified by text code, and the drive is worked out here.
    const area = await homeArea(String(body.postcode || ""));
    if (!area.ok) return bad(area.error, area.status);
    const address = String(body.address || "").trim().slice(0, 120);
    if (!address) return bad("Add the first line of your address.");
    phone = area.phone;
    visit = { address, postcode: area.postcode, lat: area.lat, lng: area.lng, drive_minutes: area.driveMinutes, drive_miles: area.driveMiles };
  } else {
    phone = ukMobile(String(body.phone || ""));
    if (!phone) return bad("Enter a UK mobile number, like 07700 900123.");
  }
  const locationType = hotel ? "hotel" : home ? "home" : "shop";
  const driveMinutes = visit?.drive_minutes;

  const slot = new Date(body.slot);
  const now = new Date();
  const free = await freeSlots(now, { serviceId: service.id, locationType, driveMinutes });
  if (!free.some((s) => s.getTime() === slot.getTime())) {
    return bad("That time has just gone. Pick another slot.");
  }

  // Priced here, never from the browser, and locked into the card hold.
  const q = quote({
    serviceId: service.id, locationType, slotAt: slot, now,
    ...(hotel ? hotelTrip(hotel) : { driveMinutes, driveMiles: visit?.drive_miles }),
  });
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
  const block = blockFor({ locationType, slotAt: slot, serviceId: service.id, driveMinutes });
  const { data: booking, error } = await db().rpc("reserve_booking", {
    p_booking: {
      name: bookingName, phone,
      service_id: service.id, service_name: service.name,
      slot_at: slot.toISOString(),
      location_type: block.locationType, block_start: block.start.toISOString(), block_end: block.end.toISOString(),
      service_price: q.servicePrice, advance_fee: q.advanceFee, distance_step: q.distanceStep, price_tier: q.tier, total: q.total,
      status: "pending",
      preferred_barber: preferred, allow_fallback: allowFallback,
      terms_accepted_at: new Date().toISOString(),
      // The barber arrives for the slot; Phase 5 refines this from where they actually are.
      ...(visit ? { ...visit, eta_at: slot.toISOString() } : {}),
      ...hotelFields,
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
  const where = hotel ? `hotel visit to ${hotel.name}, room ${(hotelFields as { room: string }).room}`
    : visit ? `home visit to ${visit.address}, ${visit.postcode}` : `${SHOP.name}, ${SHOP.address}`;
  const rules = visit
    ? `Cancel free until a barber confirms. After that the booking fee and travel are kept, nothing is refunded once your barber is on the way, and it's a no-show if you're not there ${LATE_GRACE_MINS} min after they arrive.`
    : `Cancel free until a barber confirms. After that the ${gbp(q.advanceFee)} booking fee is kept, nothing is refunded within ${CANCEL_CUTOFF_MINS} min, and the barber may leave if you are over ${LATE_GRACE_MINS} min late.`;
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
      ...(q.distanceStep
        ? [{ quantity: 1, price_data: { currency: "gbp", unit_amount: q.distanceStep, product_data: { name: hotel ? `Travel to ${hotel.name}` : `Travel (${visit!.drive_minutes} min from the shop)` } } }]
        : []),
    ],
    metadata: { booking_id: booking.id },
    payment_intent_data: {
      metadata: { booking_id: booking.id },
      // Only hold the money. It's charged when a barber taps Assign, and released if nobody does.
      // Stripe can't make a post-payment invoice for a hold, so the receipt emailed on capture is the confirmation
      // and carries the details from this description.
      capture_method: "manual",
      description: `${service.name} at ${fmtTime(slot)} on ${fmtDay(slot)}, ${where}. Track or cancel: ${site}/booking/${booking.id}. ${OPERATOR.trading} is run by ${OPERATOR.name}, sole trader, ${OPERATOR.email}.`,
    },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe's minimum; frees the slot if abandoned
    custom_text: {
      submit: {
        message: `We hold this on your card and only charge it when a barber accepts. If nobody can, the hold is released. ${rules}`,
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
