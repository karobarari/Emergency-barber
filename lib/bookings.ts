import "server-only";
import { CANCEL_CUTOFF_MINS, gbp, LATE_GRACE_MINS, mapsUrl, SHOP } from "./config";
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
    await sendSms(
      b.phone,
      `${SHOP.name}: payment received for ${fmtTime(b.slot_at)}. We'll text you as soon as your barber is confirmed. ` +
        `Full refund if you cancel before then; after that the ${gbp(b.late_fee)} late fee is kept, and nothing back within ${CANCEL_CUTOFF_MINS} min. ` +
        `Track or cancel: ${process.env.SITE_URL}/booking/${b.id}`,
    );
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
    `${barber} will open ${SHOP.name} for you at ${fmtTime(b.slot_at)}. ${SHOP.address}. Directions: ${mapsUrl()} ` +
      `Running late? Reply to let us know. After ${LATE_GRACE_MINS} min the barber may leave and nothing is refunded.`,
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

/**
 * What a customer gets back if they cancel now, or null if they can't cancel.
 * Before a barber confirms: everything. Confirmed with 30+ min to go: the service price, the late fee is kept
 * because a barber has committed to opening up. Under 30 min: nothing.
 */
export function cancelQuote(b: Booking, now = Date.now()): number | null {
  const minsLeft = (new Date(b.slot_at).getTime() - now) / 60e3;
  if (minsLeft <= 0) return null;
  if (b.status === "new") return b.total;
  if (b.status === "confirmed") return minsLeft >= CANCEL_CUTOFF_MINS ? b.service_price : 0;
  return null;
}

export type CancelResult = { ok: true; booking: Booking } | { ok: false; quote: number | null };

/**
 * Cancels for the customer. `expected` is the refund they were shown; if the quote has moved since
 * (a barber confirmed, or the cut-off passed), nothing happens and the new quote comes back.
 */
export async function cancel(id: string, expected: number): Promise<CancelResult> {
  const { data } = await db().from("bookings").select("*").eq("id", id).maybeSingle();
  const current = data as Booking | null;
  const quote = current ? cancelQuote(current) : null;
  if (!current || quote === null || quote !== expected) return { ok: false, quote };

  // Only from the status we quoted on, so a barber tapping Assign at the same moment can't slip past the quote.
  const b = await transition(id, [current.status], { status: "cancelled", refund_amount: quote });
  if (!b) return { ok: false, quote: null };
  if (quote > 0 && b.payment_intent) {
    try {
      await stripe().refunds.create({ payment_intent: b.payment_intent, amount: quote }, { idempotencyKey: `cancel-${id}` });
    } catch (e) {
      await transition(id, ["cancelled"], { status: current.status, refund_amount: null });
      throw e;
    }
  }

  try {
    await updateBookingAlert(b);
  } catch (e) {
    console.error(`Telegram update failed for cancelled booking ${id}`, e);
  }
  await sendSms(
    b.phone,
    `${SHOP.name}: your ${fmtTime(b.slot_at)} booking is cancelled. ` +
      (quote > 0 ? `${gbp(quote)} is on its way back to your card.` : "No refund is due as it was within 30 minutes."),
  );
  return { ok: true, booking: b };
}

export async function complete(id: string) {
  const b = await transition(id, ["confirmed"], { status: "done" });
  if (b) await updateBookingAlert(b);
  return b;
}
