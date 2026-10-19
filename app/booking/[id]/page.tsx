import { notFound, redirect } from "next/navigation";
import AutoRefresh from "@/app/components/AutoRefresh";
import { cancel } from "@/lib/bookings";
import { gbp, LATE_GRACE_MINS, mapsUrl, NO_SHOW_AFTER_MINS, rulesFor, SHOP } from "@/lib/config";
import { fmtTime, fmtWhen } from "@/lib/slots";
import { db, type Booking } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";
import { cancelQuote, isMobile } from "@/lib/visit";

export const dynamic = "force-dynamic";

async function cancelBooking(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let to = `/booking/${id}`;
  try {
    const r = await cancel(id, Number(form.get("expected")));
    if (!r.ok) to += "?cancel=1&changed=1";
  } catch (e) {
    await reportError(`Customer cancel failed for booking ${id}`, e);
    to += "?cancel=1&failed=1";
  }
  redirect(to);
}

type Search = { cancel?: string; changed?: string; failed?: string };

export default async function BookingStatus({ params, searchParams }: { params: { id: string }; searchParams: Search }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { data } = await db().from("bookings").select("*").eq("id", params.id).maybeSingle();
  const b = data as Booking | null;
  if (!b || b.status === "expired") notFound();

  const stage = {
    pending: 0, new: 0, confirmed: 1, on_the_way: 1, arrived: 2, done: 2, no_show: -1, refunded: -1, expired: -1, cancelled: -1,
  }[b.status];
  const live = ["pending", "new", "confirmed", "on_the_way", "arrived"].includes(b.status);
  const mobile = isMobile(b);
  const where = mobile ? `${b.address}, ${b.postcode}` : SHOP.name;
  const onlyPreferred = !!b.preferred_barber && !b.allow_fallback;
  const quote = cancelQuote(b);
  const confirming = searchParams.cancel === "1" && quote !== null;

  if (b.status === "cancelled") {
    const back = b.refund_amount ?? 0;
    return (
      <main className="wrap">
        <h2>Booking cancelled</h2>
        <p className="lead">{b.service_name} · <span className="price">{fmtWhen(b.slot_at)}</span></p>
        <div className="sum"><div className="row"><span>
          {/* No barber means it was cancelled before anyone accepted, so the card was never charged. */}
          {!b.barber ? `You weren't charged. We've released the ${gbp(b.total)} hold on your card; banks usually drop it within a few days.`
            : back > 0 ? `${gbp(back)} is on its way back to your card. Refunds usually show within 5–10 working days.`
            : mobile ? "No refund was due because your barber was already on the way."
            : "No refund was due because the booking was cancelled within 30 minutes of the slot."}
        </span></div></div>
      </main>
    );
  }

  if (b.status === "no_show") {
    return (
      <main className="wrap">
        <h2>Marked as a no-show</h2>
        <p className="lead">{b.service_name} · <span className="price">{fmtWhen(b.slot_at)}</span></p>
        <div className="sum"><div className="row"><span>
          {mobile
            ? `${b.barber} arrived at ${fmtTime(b.arrived_at!)} and waited ${NO_SHOW_AFTER_MINS} minutes but couldn't reach you. `
            : `${b.barber} waited at ${SHOP.name}, but you didn't arrive within ${LATE_GRACE_MINS} minutes of your slot. `}
          As the booking rules say, the {gbp(b.total)} isn&apos;t refunded. If something went wrong, reply to our text.
        </span></div></div>
      </main>
    );
  }

  return (
    <main className="wrap">
      {live && !confirming && <AutoRefresh seconds={15} />}
      <h2>{b.status === "refunded" ? (onlyPreferred ? `${b.preferred_barber} isn't available` : "No barber free") : stage > 0 ? "You're booked in" : "Request sent"}</h2>
      <p className="lead">
        {b.service_name} · <span className="price">{fmtWhen(b.slot_at)}</span> · {gbp(b.total)}{" "}
        {b.status === "refunded" ? "not charged" : b.status === "pending" ? "processing" : stage > 0 ? "paid" : "held on your card"}
      </p>

      {b.status === "refunded" ? (
        <>
          <div className="sum"><div className="row"><span>
            Sorry, {onlyPreferred ? `${b.preferred_barber} isn't available` : "no barber was free"} for this time. You haven&apos;t been charged, and the {gbp(b.total)} hold on your card has been released.
          </span></div></div>
          {onlyPreferred && <a className="btn" href="/" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>Book again with any barber</a>}
        </>
      ) : (
        <div className="status">
          <div className={`st ${stage > 0 ? "done" : "now"}`}><span className="dot" />
            <div><b>{b.status === "pending" ? "Checking your card" : "Request sent to the barbers"}</b><small>{stage > 0 ? "Accepted" : "You're only charged if a barber accepts"}</small></div></div>
          <div className={`st ${stage > 1 ? "done" : stage === 1 ? "now" : ""}`}><span className="dot" />
            <div><b>Barber confirmed</b><small>{b.barber
              ? (b.preferred_barber && b.preferred_barber !== b.barber
                  ? `${b.preferred_barber} wasn't free, so ${b.barber} is cutting you instead`
                  : b.status === "on_the_way" ? `${b.barber} is on the way, arriving around ${fmtTime(b.eta_at!)}`
              : b.status === "arrived" ? `${b.barber} has arrived`
              : mobile ? `${b.barber} is coming to you`
              : `${b.barber} is opening the shop for you`)
              : [
                  b.preferred_barber && `You asked for ${b.preferred_barber}${b.allow_fallback ? ", or another barber if they can't" : " only"}.`,
                  b.release_at ? `We'll confirm your barber by ${fmtWhen(b.release_at)} and text you` : "We'll text you as soon as it's confirmed",
                ].filter(Boolean).join(" ")}</small></div></div>
          <div className={`st ${stage >= 2 ? "done" : ""}`}><span className="dot" />
            <div><b>In the chair</b><small>{fmtWhen(b.slot_at)} at {where}</small></div></div>
        </div>
      )}

      {confirming && (
        <div className="sum" style={{ marginTop: 18 }}>
          {searchParams.changed === "1" && <p className="err">Your booking changed while you were deciding. Here&apos;s what applies now.</p>}
          {searchParams.failed === "1" && <p className="err">We couldn&apos;t cancel just now. Try again, or reply to our text.</p>}
          <div className="row"><span>
            {quote === b.total ? `No barber has confirmed yet, so you won't be charged. We'll release the ${gbp(quote)} hold on your card.`
              : quote > 0 ? `${b.barber} has already confirmed, so we refund the ${gbp(quote)} service but keep the ${gbp(b.advance_fee)} booking fee${b.distance_step ? ` and ${gbp(b.distance_step)} travel` : ""}.`
              : mobile ? `${b.barber} is already on the way, so no refund is due. Cancelling still lets them know to turn back.`
              : "Your slot is less than 30 minutes away, so no refund is due. Cancelling still lets the barber know not to open up."}
          </span></div>
          <form action={cancelBooking}>
            <input type="hidden" name="id" value={b.id} />
            <input type="hidden" name="expected" value={quote} />
            <button className="btn">{b.status === "new" ? "Cancel request" : quote > 0 ? `Cancel and refund ${gbp(quote)}` : "Cancel with no refund"}</button>
          </form>
          <a className="btn ghost" href={`/booking/${b.id}`} style={{ display: "block", textAlign: "center", textDecoration: "none", marginBottom: 12 }}>Keep my booking</a>
        </div>
      )}

      {b.status !== "refunded" && !confirming && (
        <div className="sum" style={{ marginTop: 18 }}>
          {mobile
            ? <div className="row"><span>Where</span><span>{where}</span></div>
            : <div className="row"><span>Where</span><span>{SHOP.address}<br /><a href={mapsUrl()} target="_blank" rel="noopener">Get directions</a></span></div>}
        </div>
      )}
      {quote !== null && !confirming && (
        <>
          <p className="note">Can&apos;t make it? <a href={`/booking/${b.id}?cancel=1`}>Cancel booking</a></p>
          <ul className="rules">{rulesFor(b.location_type).map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      {!confirming && <p className="note">Keep this page open or wait for our text. It updates on its own.</p>}
    </main>
  );
}
