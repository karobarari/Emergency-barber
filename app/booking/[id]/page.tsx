import { notFound, redirect } from "next/navigation";
import AutoRefresh from "@/app/components/AutoRefresh";
import { cancel, cancelQuote } from "@/lib/bookings";
import { gbp, mapsUrl, RULES, SHOP } from "@/lib/config";
import { fmtTime } from "@/lib/slots";
import { db, type Booking } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";

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

  const stage = { pending: 0, new: 0, confirmed: 1, done: 2, refunded: -1, expired: -1, cancelled: -1 }[b.status];
  const live = b.status === "pending" || b.status === "new" || b.status === "confirmed";
  const quote = cancelQuote(b);
  const confirming = searchParams.cancel === "1" && quote !== null;

  if (b.status === "cancelled") {
    const back = b.refund_amount ?? 0;
    return (
      <main className="wrap">
        <h2>Booking cancelled</h2>
        <p className="lead">{b.service_name} · <span className="price">{fmtTime(b.slot_at)}</span></p>
        <div className="sum"><div className="row"><span>
          {back > 0 ? `${gbp(back)} is on its way back to your card. Refunds usually show within 5–10 working days.`
            : "No refund was due because the booking was cancelled within 30 minutes of the slot."}
        </span></div></div>
      </main>
    );
  }

  return (
    <main className="wrap">
      {live && !confirming && <AutoRefresh seconds={15} />}
      <h2>{b.status === "refunded" ? "Booking refunded" : "You're booked in"}</h2>
      <p className="lead">
        {b.service_name} · <span className="price">{fmtTime(b.slot_at)}</span> · {gbp(b.total)}{" "}
        {b.status === "refunded" ? "refunded" : b.status === "pending" ? "processing" : "paid"}
      </p>

      {b.status === "refunded" ? (
        <div className="sum"><div className="row"><span>Sorry, no barber was free for this time. Your {gbp(b.total)} is on its way back to your card.</span></div></div>
      ) : (
        <div className="status">
          <div className={`st ${stage > 0 ? "done" : "now"}`}><span className="dot" />
            <div><b>{b.status === "pending" ? "Confirming payment" : "Paid and sent to the team"}</b><small>Waiting for a barber to accept</small></div></div>
          <div className={`st ${stage > 1 ? "done" : stage === 1 ? "now" : ""}`}><span className="dot" />
            <div><b>Barber confirmed</b><small>{b.barber ? `${b.barber} is opening the shop for you` : "We'll text you as soon as it's confirmed"}</small></div></div>
          <div className={`st ${stage >= 2 ? "done" : ""}`}><span className="dot" />
            <div><b>In the chair</b><small>{fmtTime(b.slot_at)} at {SHOP.name}</small></div></div>
        </div>
      )}

      {confirming && (
        <div className="sum" style={{ marginTop: 18 }}>
          {searchParams.changed === "1" && <p className="err">Your booking changed while you were deciding. Here&apos;s what applies now.</p>}
          {searchParams.failed === "1" && <p className="err">We couldn&apos;t cancel just now. Try again, or reply to our text.</p>}
          <div className="row"><span>
            {quote === b.total ? `No barber has confirmed yet, so you'll get the full ${gbp(quote)} back.`
              : quote > 0 ? `${b.barber} has already confirmed, so we refund the ${gbp(quote)} service but keep the ${gbp(b.late_fee)} late booking fee.`
              : "Your slot is less than 30 minutes away, so no refund is due. Cancelling still lets the barber know not to open up."}
          </span></div>
          <form action={cancelBooking}>
            <input type="hidden" name="id" value={b.id} />
            <input type="hidden" name="expected" value={quote} />
            <button className="btn">{quote > 0 ? `Cancel and refund ${gbp(quote)}` : "Cancel with no refund"}</button>
          </form>
          <a className="btn ghost" href={`/booking/${b.id}`} style={{ display: "block", textAlign: "center", textDecoration: "none", marginBottom: 12 }}>Keep my booking</a>
        </div>
      )}

      {b.status !== "refunded" && !confirming && (
        <div className="sum" style={{ marginTop: 18 }}>
          <div className="row"><span>Where</span><span>{SHOP.address}<br /><a href={mapsUrl()} target="_blank" rel="noopener">Get directions</a></span></div>
        </div>
      )}
      {quote !== null && !confirming && (
        <>
          <p className="note">Can&apos;t make it? <a href={`/booking/${b.id}?cancel=1`}>Cancel booking</a></p>
          <ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      {!confirming && <p className="note">Keep this page open or wait for our text. It updates on its own.</p>}
    </main>
  );
}
