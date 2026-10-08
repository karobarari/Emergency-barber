import { revalidatePath } from "next/cache";
import { assign, complete, refund } from "@/lib/bookings";
import { barbers, gbp } from "@/lib/config";
import { fmtDay, fmtTime } from "@/lib/slots";
import { db, type Booking } from "@/lib/supabase";
import AutoRefresh from "@/app/components/AutoRefresh";

export const dynamic = "force-dynamic";

async function act(form: FormData) {
  "use server";
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  if (action === "assign") await assign(id, String(form.get("barber")));
  if (action === "refund") await refund(id);
  if (action === "done") await complete(id);
  revalidatePath("/admin");
}

const LABEL: Record<string, string> = {
  new: "Needs barber", confirmed: "Confirmed", done: "Done", refunded: "Refunded",
};

export default async function Admin() {
  const since = new Date(Date.now() - 18 * 3600e3).toISOString();
  const { data } = await db()
    .from("bookings")
    .select("*")
    .gte("slot_at", since)
    .in("status", ["new", "confirmed", "done", "refunded"])
    .order("slot_at");
  const rows = (data || []) as Booking[];
  const live = rows.filter((b) => b.status === "new" || b.status === "confirmed");
  const past = rows.filter((b) => b.status === "done" || b.status === "refunded");
  const taken = rows.filter((b) => b.status !== "refunded").reduce((a, b) => a + b.total, 0);

  const card = (b: Booking) => (
    <div key={b.id} className={`card ${b.status === "new" ? "new" : ""}`}>
      <div className="ctop">
        <span className="when">{fmtTime(b.slot_at)} <small className="muted">{fmtDay(b.slot_at)}</small></span>
        <span className={`pill ${b.status}`}>{LABEL[b.status]}</span>
      </div>
      <div><b>{b.name}</b> · {b.service_name} · <span className="price">{gbp(b.total)}</span></div>
      <div className="cmeta">{b.phone}{b.barber ? ` · ${b.barber}` : ""}</div>
      {b.status === "new" && (
        <>
          <div className="assign">
            {barbers().map((n) => (
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
            <button className="small">Nobody free? Refund customer</button>
          </form>
        </>
      )}
      {b.status === "confirmed" && (
        <form action={act}>
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="action" value="done" />
          <button className="btn ghost">Mark cut as done</button>
        </form>
      )}
    </div>
  );

  return (
    <main className="wrap">
      <AutoRefresh seconds={20} />
      <h2>Dispatch</h2>
      <div className="kpis">
        <div className="kpi"><b>{rows.filter((b) => b.status === "new").length}</b><span>Need a barber</span></div>
        <div className="kpi"><b>{rows.filter((b) => b.status === "confirmed").length}</b><span>Confirmed</span></div>
        <div className="kpi"><b>{gbp(taken)}</b><span>Taken</span></div>
      </div>
      <div className="h3">Live jobs</div>
      {live.length ? live.map(card) : <p className="lead">No live jobs. New bookings appear here and in Telegram.</p>}
      {past.length > 0 && <div className="h3">Finished</div>}
      {past.map(card)}
    </main>
  );
}
