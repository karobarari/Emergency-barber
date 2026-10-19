import { revalidatePath } from "next/cache";
import { arrived, assign, complete, leftSafely, noShow, onTheWay, preferredCant, refund } from "@/lib/bookings";
import { barbers, gbp } from "@/lib/config";
import { isExclusive, mayAccept } from "@/lib/preferred";
import { fmtDay, fmtTime } from "@/lib/slots";
import { db, type Booking } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";
import { isMobile, nextActions, noShowFrom, type VisitAction } from "@/lib/visit";
import AutoRefresh from "@/app/components/AutoRefresh";

export const dynamic = "force-dynamic";

async function act(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  if (action === "assign") {
    try {
      await assign(id, String(form.get("barber")));
    } catch (e) {
      await reportError(`Charging the card failed when assigning booking ${id} from admin`, e);
    }
  }
  if (action === "cant") {
    try {
      await preferredCant(id);
    } catch (e) {
      await reportError(`"Can't" from admin failed for booking ${id}`, e);
    }
  }
  if (action === "refund") await refund(id);
  if (action === "done") await complete(id);
  if (action === "noshow") await noShow(id);
  if (action === "on_the_way") await onTheWay(id);
  if (action === "arrived") await arrived(id);
  if (action === "left") await leftSafely(id);
  revalidatePath("/admin");
}

const LABEL: Record<string, string> = {
  new: "Needs barber", confirmed: "Confirmed", on_the_way: "On the way", arrived: "Arrived", done: "Done", no_show: "No-show", refunded: "Nobody free", cancelled: "Cancelled",
};
const FINISHED = ["done", "no_show", "refunded", "cancelled"];
const UNDERWAY = ["confirmed", "on_the_way", "arrived"];
const ACTION_LABEL: Record<Exclude<VisitAction, "noshow">, string> = {
  on_the_way: "Barber on the way", arrived: "Barber arrived", done: "Mark cut as done", left: "Barber left safely",
};

export default async function Admin() {
  const since = new Date(Date.now() - 18 * 3600e3).toISOString();
  const { data } = await db()
    .from("bookings")
    .select("*")
    .gte("slot_at", since)
    .in("status", ["new", ...UNDERWAY, ...FINISHED])
    .order("slot_at");
  const rows = (data || []) as Booking[];
  // A visit isn't finished until the barber has checked out.
  const live = rows.filter((b) => b.status === "new" || UNDERWAY.includes(b.status) || (isMobile(b) && nextActions(b).includes("left")));
  const past = rows.filter((b) => FINISHED.includes(b.status) && !live.includes(b));
  const now = Date.now();
  // Unclaimed bookings are only held, not charged. Cancellations keep whatever wasn't refunded (the booking fee, or everything inside 30 min).
  // No-shows keep the full charge.
  const taken = rows.filter((b) => b.status !== "refunded" && b.status !== "new").reduce((a, b) => a + b.total - (b.refund_amount ?? 0), 0);

  const card = (b: Booking) => (
    <div key={b.id} className={`card ${b.status === "new" ? "new" : ""}`}>
      <div className="ctop">
        <span className="when">{fmtTime(b.slot_at)} <small className="muted">{fmtDay(b.slot_at)}</small></span>
        <span className={`pill ${b.status}`}>{LABEL[b.status]}</span>
      </div>
      <div><b>{b.name}</b> · {b.service_name} · <span className="price">{gbp(b.total)}</span></div>
      <div className="cmeta">{b.phone}{b.barber ? ` · ${b.barber}` : ""}{b.status === "cancelled" ? ` · refunded ${gbp(b.refund_amount ?? 0)}` : ""}</div>
      {isMobile(b) && (
        <div className="cmeta">
          {b.hotel_id ? "🏨" : "🏠"} {b.address}, {b.postcode} · {b.drive_minutes} min drive{b.distance_step ? ` · ${gbp(b.distance_step)} travel` : ""}
          {b.hotel_id ? ` · room ${b.room}, booked by ${b.booker_name}` : ""}
        </div>
      )}
      {b.preferred_barber && (
        <div className="cmeta">
          Requested {b.preferred_barber}{b.allow_fallback ? "" : " only"}
          {b.status === "new" && isExclusive(b, now) && b.allow_fallback ? `, theirs until ${fmtTime(b.exclusive_until!)}` : ""}
        </div>
      )}
      {b.status === "new" && (
        <>
          <div className="assign">
            {barbers().filter((n) => mayAccept(b, n, now)).map((n) => (
              <form action={act} key={n}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="action" value="assign" />
                <input type="hidden" name="barber" value={n} />
                <button>{n}</button>
              </form>
            ))}
          </div>
          <form action={act}>
            <input type="hidden" name="id" value={b.id} />
            <input type="hidden" name="action" value="refund" />
            <button className="small">Nobody free? Release customer&apos;s hold</button>
          </form>
          {b.preferred_barber && b.allow_fallback && b.exclusive_until && (
            <form action={act}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="action" value="cant" />
              <button className="small">{b.preferred_barber} can&apos;t? Open to everyone</button>
            </form>
          )}
        </>
      )}
      {nextActions(b).map((a) => {
        if (a !== "noshow") {
          return (
            <form action={act} key={a}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="action" value={a} />
              <button className="btn ghost">{ACTION_LABEL[a]}</button>
            </form>
          );
        }
        const from = noShowFrom(b);
        return from && now >= from.getTime() ? (
          <form action={act} key={a}>
            <input type="hidden" name="id" value={b.id} />
            <input type="hidden" name="action" value="noshow" />
            <button className="small">Customer didn&apos;t show? Mark no-show (charge kept)</button>
          </form>
        ) : (
          <span className="muted" key={a}>No-show can be marked from {from ? fmtTime(from) : "15 min after the barber arrives"}</span>
        );
      })}
    </div>
  );

  return (
    <main className="wrap">
      <AutoRefresh seconds={20} />
      <h2>Dispatch</h2>
      <p className="note"><a href="/admin/customers">Customers</a> · <a href="/admin/hotels">Hotels</a></p>
      <div className="kpis">
        <div className="kpi"><b>{rows.filter((b) => b.status === "new").length}</b><span>Need a barber</span></div>
        <div className="kpi"><b>{rows.filter((b) => UNDERWAY.includes(b.status)).length}</b><span>Confirmed</span></div>
        <div className="kpi"><b>{gbp(taken)}</b><span>Taken</span></div>
      </div>
      <div className="h3">Live jobs</div>
      {live.length ? live.map(card) : <p className="lead">No live jobs. New bookings appear here and in Telegram.</p>}
      {past.length > 0 && <div className="h3">Finished</div>}
      {past.map(card)}
    </main>
  );
}
