import "server-only";
import { CANCEL_CUTOFF_MINS, DISPATCH, DONE_NUDGE_MINS, gbp, LATE_GRACE_MINS, mapsUrl, SHOP, SLOT_REMINDER_MINS } from "./config";
import { noShowFrom, releaseAt, remindAt } from "./dispatch";
import { exclusiveUntil, mayAccept, whenPreferredCant } from "./preferred";
import { fmtTime, fmtWhen } from "./slots";
import { sendSms } from "./sms";
import { stripe } from "./stripe";
import { db, type Booking, type Status } from "./supabase";
import { reportError, sendBookingAlert, sendDoneNudge, sendOpenedNotice, sendReminder, updateBookingAlert } from "./telegram";

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

/**
 * Gives the customer's money back. Until a barber accepts, the money is only held on the card, so the hold is
 * released in full (no refund, no Stripe fee). Once it's been taken, `amount` is refunded (all of it by default).
 */
async function giveBack(paymentIntent: string, key: string, amount?: number): Promise<"released" | "refunded"> {
  const pi = await stripe().paymentIntents.retrieve(paymentIntent);
  if (pi.status === "requires_capture") {
    await stripe().paymentIntents.cancel(paymentIntent, {}, { idempotencyKey: `${key}-release` });
    return "released";
  }
  if (pi.status === "succeeded") {
    await stripe().refunds.create({ payment_intent: paymentIntent, amount }, { idempotencyKey: key });
    return "refunded";
  }
  return "released"; // canceled: the hold already lapsed, so nothing was ever taken
}

/** Called by the Stripe webhook once the card hold is in place. Nothing is charged until a barber accepts. */
export async function markHeld(id: string, paymentIntent: string | null) {
  const { data: pending, error } = await db()
    .from("bookings")
    .select("slot_at, price_tier, preferred_barber, allow_fallback")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Booking ${id} lookup failed: ${error.message}`);
  if (!pending) return;
  const paidAt = new Date();
  // Fixed now, so the cron, the status page and Telegram all agree on when an unclaimed hold is released.
  let release = releaseAt(paidAt, new Date(pending.slot_at), pending.price_tier);
  let exclusive: Date | null = null;
  if (pending.preferred_barber) {
    exclusive = exclusiveUntil(paidAt, pending.price_tier, release);
    // Only that barber will do, so there's nothing to wait for once their window is over.
    if (!pending.allow_fallback) release = exclusive;
  }
  const b = await transition(id, ["pending"], {
    status: "new",
    payment_intent: paymentIntent,
    paid_at: paidAt.toISOString(),
    release_at: release.toISOString(),
    exclusive_until: exclusive?.toISOString() ?? null,
  });
  if (!b) return;
  const ahead = b.price_tier !== "standard";
  // The hold is already placed, so a Stripe retry would skip these. Log failures instead of throwing.
  try {
    const msgId = await sendBookingAlert(b);
    if (msgId) await db().from("bookings").update({ telegram_message_id: msgId }).eq("id", id);
  } catch (e) {
    await reportError(`Telegram alert failed for booking ${id}`, e);
  }
  try {
    await sendSms(
      b.phone,
      `${SHOP.name}: request sent${b.preferred_barber ? ` to ${b.preferred_barber}` : ""} for ${fmtWhen(b.slot_at)}. We've held ${gbp(b.total)} on your card but only charge it when a barber accepts. ` +
        `We'll text you as soon as one does${ahead ? `, by ${fmtWhen(b.release_at!)} at the latest` : ""}. ` +
        `Cancel free until then; after that the ${gbp(b.advance_fee)} booking fee is kept, and nothing back within ${CANCEL_CUTOFF_MINS} min. ` +
        `Track or cancel: ${process.env.SITE_URL}/booking/${b.id}`,
    );
  } catch (e) {
    await reportError(`Request text failed for booking ${id}`, e);
  }
}

export async function getBooking(id: string) {
  const { data, error } = await db().from("bookings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Booking ${id} lookup failed: ${error.message}`);
  return data as Booking | null;
}

/**
 * A barber accepts: claim the booking, then take the held money. Throws (and un-claims) if the charge fails.
 * Returns "not_allowed" if the customer asked for someone else and it's still theirs (see lib/preferred.ts).
 */
export async function assign(id: string, barber: string): Promise<Booking | "not_allowed" | null> {
  const current = await getBooking(id);
  if (!current || current.status !== "new") return null;
  if (!mayAccept(current, barber)) return "not_allowed";
  const b = await transition(id, ["new"], { status: "confirmed", barber });
  if (!b) return null;
  if (b.payment_intent) {
    try {
      await stripe().paymentIntents.capture(b.payment_intent);
    } catch (e) {
      // A retry after a timeout may find it already captured, which is fine.
      const pi = await stripe().paymentIntents.retrieve(b.payment_intent).catch(() => null);
      if (pi?.status !== "succeeded") {
        await transition(id, ["confirmed"], { status: "new", barber: null });
        throw e;
      }
    }
  }
  await updateBookingAlert(b);
  const instead = b.preferred_barber && b.preferred_barber !== barber ? `${b.preferred_barber} wasn't free, so ${barber} is cutting you instead. ` : "";
  await sendSms(
    b.phone,
    `${instead}${barber} will open ${SHOP.name} for you at ${fmtWhen(b.slot_at)}. We've now charged the ${gbp(b.total)} held on your card. ` +
      `${SHOP.address}. Directions: ${mapsUrl()} ` +
      `Running late? Reply to let us know. After ${LATE_GRACE_MINS} min the barber may leave and nothing is refunded.`,
  );
  return b;
}

export async function refund(id: string) {
  const b = await transition(id, ["new", "confirmed"], { status: "refunded" });
  if (!b) return null;
  let how: "released" | "refunded" = "released";
  if (b.payment_intent) {
    try {
      how = await giveBack(b.payment_intent, `refund-${id}`);
    } catch (e) {
      // Undo the claim so someone can try again. A barber is only set once the booking is confirmed.
      await transition(id, ["refunded"], { status: b.barber ? "confirmed" : "new" });
      throw e;
    }
  }
  await updateBookingAlert(b);
  const onlyPreferred = b.preferred_barber && !b.allow_fallback;
  await sendSms(
    b.phone,
    (onlyPreferred
      ? `${SHOP.name}: sorry, ${b.preferred_barber} isn't available for ${fmtWhen(b.slot_at)}. `
      : `${SHOP.name}: sorry, no barber is free for ${fmtWhen(b.slot_at)}. `) +
      (how === "released"
        ? `You haven't been charged. We've released the ${gbp(b.total)} hold on your card.`
        : `We've refunded ${gbp(b.total)} to your card.`) +
      (onlyPreferred ? ` Book again with any barber: ${process.env.SITE_URL}/` : ""),
  );
  return b;
}

/**
 * Ends the requested barber's exclusive window early: they tapped "can't", or (from the cron) their time ran out.
 * Opens the alert to everyone if the customer is happy with another barber, otherwise releases the hold.
 */
export async function preferredCant(id: string, why: "cant" | "timeout" = "cant") {
  const b = await getBooking(id);
  if (!b || b.status !== "new" || !b.preferred_barber) return null;
  if (whenPreferredCant(b) === "release") return refund(id);
  // Only once, so the cron and a "can't" tap landing together don't both post.
  const opened = await db()
    .from("bookings")
    .update({ exclusive_until: null })
    .eq("id", id)
    .eq("status", "new")
    .not("exclusive_until", "is", null)
    .select()
    .maybeSingle();
  if (opened.error) throw new Error(`Opening booking ${id} to all barbers failed: ${opened.error.message}`);
  const o = opened.data as Booking | null;
  if (!o) return null;
  await updateBookingAlert(o);
  await sendOpenedNotice(o, why);
  return o;
}

/** Runs every couple of minutes. Opens bookings to every barber once the requested barber's window is over. */
export async function openExpiredWindows(now = Date.now()) {
  const { data, error } = await db()
    .from("bookings")
    .select("id")
    .eq("status", "new")
    .eq("allow_fallback", true)
    .lte("exclusive_until", new Date(now).toISOString());
  if (error) throw new Error(`Exclusive window query failed: ${error.message}`);
  let opened = 0;
  for (const { id } of data || []) {
    try {
      if (await preferredCant(id, "timeout")) opened++;
    } catch (e) {
      await reportError(`Opening booking ${id} to all barbers failed`, e);
    }
  }
  return opened;
}

/**
 * What a customer gets back if they cancel now, or null if they can't cancel.
 * Before a barber confirms: everything (the hold is released). Confirmed with 30+ min to go: the service price, the booking fee is kept
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
  let how: "released" | "refunded" = "refunded";
  if (quote > 0 && b.payment_intent) {
    try {
      // Before a barber accepts, the quote is the full total and the hold is simply released.
      how = await giveBack(b.payment_intent, `cancel-${id}`, quote);
    } catch (e) {
      await transition(id, ["cancelled"], { status: current.status, refund_amount: null });
      throw e;
    }
  }

  try {
    await updateBookingAlert(b);
  } catch (e) {
    await reportError(`Telegram update failed for cancelled booking ${id}`, e);
  }
  await sendSms(
    b.phone,
    `${SHOP.name}: your booking for ${fmtWhen(b.slot_at)} is cancelled. ` +
      (quote === 0 ? "No refund is due as it was within 30 minutes."
        : how === "released" ? `You haven't been charged. We've released the ${gbp(quote)} hold on your card.`
        : `${gbp(quote)} is on its way back to your card.`),
  );
  return { ok: true, booking: b };
}

/** The cut is finished. Shop visits are counted on the customer, which later unlocks home visits (SPEC-v2 §6). */
export async function complete(id: string) {
  const b = await transition(id, ["confirmed"], { status: "done" });
  if (!b) return null;
  if (b.location_type === "shop") {
    // The booking is already done, so a retry would skip this. Report it instead, and fix the count by hand.
    const { error } = await db().rpc("record_shop_visit", { p_phone: b.phone, p_name: b.name, p_barber: b.barber });
    if (error) await reportError(`Couldn't count the visit for ${b.phone} (booking ${id})`, error);
  }
  await updateBookingAlert(b);
  return b;
}

export type NoShowResult = { ok: true; booking: Booking } | { ok: false; from: Date | null };

/**
 * The customer didn't turn up. Only once they're past the lateness grace, so a barber can't mark it early by mistake.
 * The full charge is kept. `from` comes back when it's too early, or null if the booking isn't confirmed.
 */
export async function noShow(id: string, now = Date.now()): Promise<NoShowResult> {
  const { data } = await db().from("bookings").select("slot_at").eq("id", id).maybeSingle();
  if (!data) return { ok: false, from: null };
  const from = noShowFrom(new Date(data.slot_at));
  if (now < from.getTime()) return { ok: false, from };
  const b = await transition(id, ["confirmed"], { status: "no_show" });
  if (!b) return { ok: false, from: null };
  try {
    await updateBookingAlert(b);
  } catch (e) {
    await reportError(`Telegram update failed for no-show ${id}`, e);
  }
  await sendSms(
    b.phone,
    `${SHOP.name}: we waited for you at ${fmtTime(b.slot_at)} but you didn't arrive, so your booking is marked as a no-show. ` +
      `As the booking rules say, the ${gbp(b.total)} isn't refunded. Reply if something went wrong.`,
  );
  return { ok: true, booking: b };
}

/**
 * Runs every couple of minutes. Asks the barber once to tap Done or No-show when a cut should have finished
 * a while ago, so finished visits get counted.
 */
export async function nudgeUnfinished(now = Date.now()) {
  // block_end is when the cut should finish, so anything ending before this is overdue.
  const overdue = new Date(now - DONE_NUDGE_MINS * 60e3).toISOString();
  const { data, error } = await db()
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .is("done_nudged_at", null)
    .lt("block_end", overdue);
  if (error) throw new Error(`Unfinished bookings query failed: ${error.message}`);

  let sent = 0;
  for (const b of (data || []) as Booking[]) {
    // Claim it first so two overlapping runs can't both nudge.
    const { data: claimed } = await db()
      .from("bookings")
      .update({ done_nudged_at: new Date(now).toISOString() })
      .eq("id", b.id)
      .is("done_nudged_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      await updateBookingAlert(b); // alerts confirmed before the Done button existed get it now
      await sendDoneNudge(b);
      sent++;
    } catch (e) {
      await db().from("bookings").update({ done_nudged_at: null }).eq("id", b.id); // try again next run
      await reportError(`Done nudge failed for booking ${b.id}`, e);
    }
  }
  return sent;
}

/**
 * Runs every couple of minutes. Re-pings the group once about bookings nobody has taken, then releases the card hold
 * at `release_at` (the same as tapping "Nobody free") so a customer is never left waiting on a barber who isn't coming.
 * Timings depend on how far ahead it was booked (see lib/dispatch.ts).
 */
export async function chaseUnclaimed(now = Date.now()) {
  // Nothing is due before the shortest re-ping time.
  const since = new Date(now - DISPATCH.soon.remindMins * 60e3).toISOString();
  const { data, error } = await db().from("bookings").select("*").eq("status", "new").lt("paid_at", since);
  if (error) throw new Error(`Unclaimed bookings query failed: ${error.message}`);

  const result = { reminded: 0, refunded: 0, failed: 0 };
  for (const b of (data || []) as Booking[]) {
    const paidAt = new Date(b.paid_at!);
    const release = b.release_at ? new Date(b.release_at) : releaseAt(paidAt, new Date(b.slot_at), b.price_tier);
    try {
      if (now >= release.getTime()) {
        if (await refund(b.id)) result.refunded++;
      } else if (!b.reminded_at && now >= remindAt(paidAt, b.price_tier).getTime()) {
        // Claim the reminder first so two overlapping runs can't both send it.
        const { data: claimed } = await db()
          .from("bookings")
          .update({ reminded_at: new Date(now).toISOString() })
          .eq("id", b.id)
          .eq("status", "new")
          .is("reminded_at", null)
          .select("id")
          .maybeSingle();
        if (!claimed) continue;
        try {
          const msgId = await sendReminder(b, release, new Date(now));
          if (msgId) await db().from("bookings").update({ telegram_message_id: msgId }).eq("id", b.id);
          result.reminded++;
        } catch (e) {
          await db().from("bookings").update({ reminded_at: null }).eq("id", b.id); // try again next run
          throw e;
        }
      }
    } catch (e) {
      await reportError(`No-barber check failed for booking ${b.id}`, e);
      result.failed++;
    }
  }
  return result;
}

/** Runs every couple of minutes. Texts each confirmed customer once, shortly before their slot, with directions. */
export async function remindCustomers(now = Date.now()) {
  const { data, error } = await db()
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .is("slot_reminded_at", null)
    .gt("slot_at", new Date(now).toISOString())
    .lte("slot_at", new Date(now + SLOT_REMINDER_MINS * 60e3).toISOString());
  if (error) throw new Error(`Reminder query failed: ${error.message}`);

  let sent = 0;
  for (const b of (data || []) as Booking[]) {
    // Claim it first so two overlapping runs can't both text the customer.
    const { data: claimed } = await db()
      .from("bookings")
      .update({ slot_reminded_at: new Date(now).toISOString() })
      .eq("id", b.id)
      .is("slot_reminded_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await sendSms(
      b.phone,
      `${SHOP.name}: see you at ${fmtTime(b.slot_at)}. ${b.barber} is opening up at ${SHOP.address}. ` +
        `Directions: ${mapsUrl()} Running late? Reply to let us know. After ${LATE_GRACE_MINS} min the barber may leave.`,
    );
    sent++;
  }
  return sent;
}
