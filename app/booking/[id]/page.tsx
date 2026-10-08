import { notFound } from "next/navigation";
import AutoRefresh from "@/app/components/AutoRefresh";
import { gbp, mapsUrl, SHOP } from "@/lib/config";
import { fmtTime } from "@/lib/slots";
import { db, type Booking } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function BookingStatus({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { data } = await db().from("bookings").select("*").eq("id", params.id).maybeSingle();
  const b = data as Booking | null;
  if (!b || b.status === "expired") notFound();

  const stage = { pending: 0, new: 0, confirmed: 1, done: 2, refunded: -1, expired: -1 }[b.status];
  const live = b.status === "pending" || b.status === "new" || b.status === "confirmed";

  return (
    <main className="wrap">
      {live && <AutoRefresh seconds={15} />}
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

      {b.status !== "refunded" && (
        <div className="sum" style={{ marginTop: 18 }}>
          <div className="row"><span>Where</span><span>{SHOP.address}<br /><a href={mapsUrl()} target="_blank" rel="noopener">Get directions</a></span></div>
        </div>
      )}
      <p className="note">Keep this page open or wait for our text. It updates on its own.</p>
    </main>
  );
}
