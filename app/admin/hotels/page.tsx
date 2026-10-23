import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gbp, PRICING } from "@/lib/config";
import { hotelTravel } from "@/lib/hotels";
import { driveFromShop, formatPostcode, lookupPostcode } from "@/lib/routing";
import { db, type Hotel } from "@/lib/supabase";
import { reportError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max) || null;
const back = (error: string) => redirect(`/admin/hotels?error=${encodeURIComponent(error)}`);

async function save(form: FormData) {
  "use server";
  const id = text(form, "id");
  const name = text(form, "name", 120);
  const address = text(form, "address");
  const postcodeInput = text(form, "postcode", 10);
  if (!name || !address || !postcodeInput) return back("Name, address and postcode are needed.");
  const slug = slugify(text(form, "slug", 60) || name);
  if (!slug) return back("The link name needs letters or numbers.");

  const place = await lookupPostcode(postcodeInput).catch(() => null);
  if (!place) return back(`We couldn't find the postcode ${postcodeInput}.`);

  // Typed in, or worked out from the postcode once ROUTING_API_KEY is set.
  let minutes = Number(form.get("drive_minutes")) || null;
  let miles = Number(form.get("drive_miles")) || null;
  if (!minutes || !miles) {
    if (!process.env.ROUTING_API_KEY) return back("Enter the drive time and miles from the shop (or set ROUTING_API_KEY to work them out).");
    try {
      const d = await driveFromShop(postcodeInput);
      minutes = d?.minutes ?? null;
      miles = d?.miles ?? null;
    } catch (e) {
      await reportError(`Drive time lookup failed for hotel ${name}`, e);
    }
    if (!minutes || !miles) return back("Couldn't work out the drive. Enter the minutes and miles by hand.");
  }
  if (miles > PRICING.maxDriveMiles) return back(`${name} is ${miles} miles away, over our ${PRICING.maxDriveMiles}-mile area.`);

  const override = String(form.get("override") ?? "").trim();
  const row = {
    slug, name, address, postcode: formatPostcode(place.postcode), lat: place.lat, lng: place.lng,
    drive_minutes: Math.round(minutes), drive_miles: miles,
    arrival_notes: text(form, "arrival_notes", 300),
    contact_name: text(form, "contact_name", 80),
    contact_phone: text(form, "contact_phone", 30),
    contact_email: text(form, "contact_email", 120),
    // Pounds in the form, pence in the database. Blank means use the drive-time travel charge.
    distance_step_override: override === "" ? null : Math.round(Number(override) * 100),
    active: form.get("active") === "on",
  };
  if (row.distance_step_override !== null && !(row.distance_step_override >= 0)) return back("The fixed travel charge must be a number of pounds, like 10.");

  const { error } = id ? await db().from("hotels").update(row).eq("id", id) : await db().from("hotels").insert(row);
  if (error) return back(error.code === "23505" ? `The link /h/${slug} is already taken. Pick another link name.` : error.message);
  revalidatePath("/admin/hotels");
  redirect("/admin/hotels");
}

function HotelForm({ h }: { h?: Hotel }) {
  return (
    <form action={save}>
      {h && <input type="hidden" name="id" value={h.id} />}
      <label className="f">Hotel name</label>
      <input className="t" name="name" defaultValue={h?.name} required />
      <label className="f">Link name <small className="muted">(/h/link-name; blank to make one from the name)</small></label>
      <input className="t" name="slug" defaultValue={h?.slug} />
      <label className="f">Address</label>
      <input className="t" name="address" defaultValue={h?.address} required />
      <label className="f">Postcode</label>
      <input className="t" name="postcode" defaultValue={h?.postcode} required />
      <label className="f">Drive from the shop <small className="muted">(minutes and miles; blank to work out from the postcode)</small></label>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="t" name="drive_minutes" inputMode="numeric" placeholder="min" defaultValue={h?.drive_minutes ?? ""} />
        <input className="t" name="drive_miles" inputMode="decimal" placeholder="miles" defaultValue={h?.drive_miles ?? ""} />
      </div>
      <label className="f">Fixed travel charge, £ <small className="muted">(blank to charge by drive time)</small></label>
      <input className="t" name="override" inputMode="decimal" defaultValue={h?.distance_step_override != null ? h.distance_step_override / 100 : ""} />
      <label className="f">Arrival notes for the barber</label>
      <input className="t" name="arrival_notes" placeholder="Report to the front desk" defaultValue={h?.arrival_notes ?? ""} />
      <label className="f">Contact</label>
      <input className="t" name="contact_name" placeholder="Name" defaultValue={h?.contact_name ?? ""} />
      <input className="t" name="contact_phone" placeholder="Phone" defaultValue={h?.contact_phone ?? ""} style={{ marginTop: 6 }} />
      <input className="t" name="contact_email" placeholder="Email" defaultValue={h?.contact_email ?? ""} style={{ marginTop: 6 }} />
      <label className="agree"><input type="checkbox" name="active" defaultChecked={h?.active ?? true} /> Link is live</label>
      <button className="btn ghost">{h ? "Save" : "Add hotel"}</button>
    </form>
  );
}

const travelFor = (h: Hotel) => {
  const pence = hotelTravel({ ...h, drive_miles: Number(h.drive_miles) });
  return pence ? gbp(pence) : "free";
};

export default async function Hotels(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  const { data } = await db().from("hotels").select("*").order("name");
  const rows = (data || []) as Hotel[];
  const site = process.env.SITE_URL || "";

  return (
    <main className="wrap">
      <h2>Hotels</h2>
      <p className="note"><a href="/admin">Back to dispatch</a></p>
      <p className="lead">Each hotel gets a private booking link for its concierge. Guests are charged on the concierge&apos;s card.</p>
      {searchParams.error && <p className="err">{searchParams.error}</p>}

      {rows.map((h) => (
        <div key={h.id} className="card">
          <div className="ctop">
            <span className="when">{h.name}</span>
            <span className={`pill ${h.active ? "done" : "off"}`}>{h.active ? "Live" : "Off"}</span>
          </div>
          <div className="cmeta">
            {h.address}, {h.postcode} · {h.drive_minutes} min / {h.drive_miles} mi · travel {travelFor(h)}
          </div>
          <div className="cmeta"><a href={`/h/${h.slug}`} target="_blank" rel="noopener">{site}/h/{h.slug}</a></div>
          <details>
            <summary className="small">Edit</summary>
            <HotelForm h={h} />
          </details>
        </div>
      ))}

      <div className="h3">Add a hotel</div>
      <HotelForm />
    </main>
  );
}
