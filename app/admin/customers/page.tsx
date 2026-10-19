import { revalidatePath } from "next/cache";
import { fmtDay } from "@/lib/slots";
import { db, type Customer } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

async function save(form: FormData) {
  "use server";
  const phone = String(form.get("phone"));
  const notes = String(form.get("notes") ?? "").trim();
  const { error } = await db()
    .from("customers")
    .update({
      home_allowed: form.get("home_allowed") === "on",
      blocked: form.get("blocked") === "on",
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("phone", phone);
  if (error) await reportError(`Saving customer ${phone} from admin failed`, error);
  revalidatePath("/admin/customers");
}

export default async function Customers({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  let query = db().from("customers").select("*").order("updated_at", { ascending: false }).limit(200);
  // Commas and brackets would break the or() filter, and nobody types them into a name or number.
  const term = q.replace(/[,()]/g, "");
  if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data } = await query;
  const rows = (data || []) as Customer[];

  return (
    <main className="wrap">
      <h2>Customers</h2>
      <p className="note"><a href="/admin">Back to dispatch</a></p>
      <p className="lead">Added when a shop cut is marked done. A finished shop visit unlocks home visits; blocked overrides that.</p>
      <form>
        <input className="t" name="q" defaultValue={q} placeholder="Search name or number" aria-label="Search customers" />
      </form>

      {rows.length === 0 && <p className="lead" style={{ marginTop: 18 }}>{q ? "No customers match." : "No customers yet."}</p>}
      {rows.map((c) => (
        <form action={save} key={c.phone} className="card">
          <input type="hidden" name="phone" value={c.phone} />
          <div className="ctop">
            <span className="when">{c.name || "No name"}</span>
            {c.blocked ? <span className="pill off">Blocked</span> : c.home_allowed && <span className="pill done">Home OK</span>}
          </div>
          <div className="cmeta">
            {c.phone} · {c.completed_shop_visits} shop {c.completed_shop_visits === 1 ? "visit" : "visits"}
            {c.last_barber ? ` · last with ${c.last_barber}` : ""} · since {fmtDay(c.created_at)}
          </div>
          <label className="agree"><input type="checkbox" name="home_allowed" defaultChecked={c.home_allowed} /> Home visits allowed</label>
          <label className="agree"><input type="checkbox" name="blocked" defaultChecked={c.blocked} /> Blocked</label>
          <label className="f" htmlFor={`notes-${c.phone}`}>Notes (only you see these)</label>
          <textarea className="t" id={`notes-${c.phone}`} name="notes" rows={2} defaultValue={c.notes ?? ""} />
          <button className="btn ghost" style={{ marginTop: 4 }}>Save</button>
        </form>
      ))}
    </main>
  );
}
