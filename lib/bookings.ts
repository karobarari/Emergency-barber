import "server-only";
import { gbp, mapsUrl, SHOP } from "./config";
import { fmtTime } from "./slots";
import { sendSms } from "./sms";
import { stripe } from "./stripe";
import { db, type Booking, type Status } from "./supabase";
import { sendBookingAlert, updateBookingAlert } from "./telegram";

/**
 * Moves a booking from one status to another only if it's still in `from`, so two barbers can't both claim it.
 * Returns null if the booking wasn't in `from`. Throws on database errors so callers (and Stripe) can retry.
 */
async function transition(id: string, from: Status[], patch: Partial<Booking>) {
  const { data, error } = await db()
    .from("bookings")
    .update(patch)
    .eq("id", id)
    .in("status", from)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Booking ${id} update failed: ${error.message}`);
  return data as Booking | null;
}

/** Called by the Stripe webhook once payment succeeds. */
export async function markPaid(id: string, paymentIntent: string | null) {
  const b = await transition(id, ["pending"], { status: "new", payment_intent: paymentIntent });
  if (!b) return;
  // The booking is already paid, so a Stripe retry would skip these. Log failures instead of throwing.
  try {
    const msgId = await sendBookingAlert(b);
    if (msgId) await db().from("bookings").update({ telegram_message_id: msgId }).eq("id", id);
  } catch (e) {
    console.error(`Telegram alert failed for booking ${id}`, e);
  }
  try {
    await sendSms(b.phone, `${SHOP.name}: payment received for ${fmtTime(b.slot_at)}. We'll text you as soon as your barber is confirmed.`);
  } catch (e) {
    console.error(`Payment SMS failed for booking ${id}`, e);
  }
}

export async function assign(id: string, barber: string) {
  const b = await transition(id, ["new"], { status: "confirmed", barber });
  if (!b) return null;
  await updateBookingAlert(b);
  await sendSms(
    b.phone,
    `${barber} will open ${SHOP.name} for you at ${fmtTime(b.slot_at)}. ${SHOP.address}. Directions: ${mapsUrl()} Reply if you're running late.`,
  );
  return b;
}

export async function refund(id: string) {
  const b = await transition(id, ["new", "confirmed"], { status: "refunded" });
  if (!b) return null;
  if (b.payment_intent) {
    try {
      await stripe().refunds.create({ payment_intent: b.payment_intent }, { idempotencyKey: `refund-${id}` });
    } catch (e) {
      // Undo the claim so someone can try again. A barber is only set once the booking is confirmed.
      await transition(id, ["refunded"], { status: b.barber ? "confirmed" : "new" });
      throw e;
    }
  }
  await updateBookingAlert(b);
  await sendSms(b.phone, `${SHOP.name}: sorry, no barber is free for ${fmtTime(b.slot_at)}. We've refunded ${gbp(b.total)} to your card.`);
  return b;
}

export async function complete(id: string) {
  const b = await transition(id, ["confirmed"], { status: "done" });
  if (b) await updateBookingAlert(b);
  return b;
}
