"use client";
import { useEffect, useState } from "react";

type Service = { id: string; name: string; mins: number; price: number };
type Fee = { minHoursAhead: number; fee: number };
type Slot = { at: string; fee: number; tierLabel: string };
type Night = { key: string; label: string; slots: Slot[] };
type Props = { services: Service[]; fees: Fee[]; advanceDays: number; shop: string; address: string; maps: string; rules: string[] };

const gbp = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

function Steps({ n }: { n: number }) {
  return <div className="steps">{[1, 2, 3, 4].map((i) => <span key={i} className={i <= n ? "on" : ""} />)}</div>;
}

export default function BookingFlow({ services, fees, advanceDays, shop, address, maps, rules }: Props) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [nights, setNights] = useState<Night[] | null>(null);
  const [nightKey, setNightKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const svc = services.find((s) => s.id === serviceId);
  const total = svc && slot ? svc.price + slot.fee : 0;
  const cheapest = Math.min(...fees.map((f) => f.fee));
  const dearest = Math.max(...fees.map((f) => f.fee));

  const loadSlots = () => {
    setNights(null);
    // Longer services need more free time after the slot, so the list depends on the service.
    fetch(`/api/slots?service=${serviceId}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Night[] = d.nights || [];
        setNights(list);
        // Keep the picked slot only if it still has room for this service, with its latest fee.
        setSlot((s) => list.flatMap((n) => n.slots).find((x) => x.at === s?.at) ?? null);
        // Stay on the chosen evening if it still has slots, otherwise jump to the first one that does.
        setNightKey((k) => (list.find((n) => n.key === k && n.slots.length) ?? list.find((n) => n.slots.length))?.key ?? null);
      })
      .catch(() => setNights([]));
  };
  useEffect(() => { if (step === 2) loadSlots(); }, [step]);

  const night = nights?.find((n) => n.key === nightKey);
  const nightLabel = (iso: string) => nights?.find((n) => n.slots.some((s) => s.at === iso))?.label ?? "";

  // The cheaper option, if there is one: the earliest slot with a lower booking fee than the one picked (or the first free one).
  const all = nights?.flatMap((n) => n.slots.map((s) => ({ ...s, night: n }))) ?? [];
  const compareFee = slot?.fee ?? all[0]?.fee ?? 0;
  const lowestFee = Math.min(...all.map((s) => s.fee));
  const saving = all.find((s) => s.fee === lowestFee && s.fee < compareFee);
  // "Book for tomorrow", but "Book for Wed 21 Oct".
  const forNight = (label: string) => (/^To/.test(label) ? label.toLowerCase() : label);

  async function pay() {
    if (!slot) return;
    setBusy(true); setError("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, slot: slot.at, name, phone, agreed, expectedTotal: total }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.url) { window.location.href = data.url; return; }
    setBusy(false);
    setError(data?.error || "Something went wrong. Check your connection and try again.");
    // The booking fee went up since the slot list loaded. Show the new price and let them decide.
    if (data?.quote) setSlot({ ...slot, fee: data.quote.fee, tierLabel: data.quote.tierLabel });
    else if (data?.error?.includes("slot")) { setSlot(null); setStep(2); }
  }

  if (step === 1) return (
    <>
      <Steps n={1} />
      <h2>Need a cut out of hours?</h2>
      <p className="lead">A barber opens {shop} just for you, tonight or up to {advanceDays} days ahead. Send a request, pay only when a barber accepts, then walk straight into the chair.</p>
      <div className="sum">
        <div className="row"><span>Where</span><span>{address}<br /><a href={maps} target="_blank" rel="noopener">Get directions</a></span></div>
        <div className="row"><span>When</span><span>19:00 to midnight, at least 1 hour&apos;s notice</span></div>
        <div className="row"><span>Booking fee</span><span className="price">{gbp(cheapest)}–{gbp(dearest)}</span></div>
      </div>
      <label className="f">What do you need?</label>
      <div className="opts">
        {services.map((s) => (
          <button key={s.id} className="opt" aria-pressed={serviceId === s.id} onClick={() => setServiceId(s.id)}>
            <span><b>{s.name}</b><small>about {s.mins} min</small></span>
            <span className="price">{gbp(s.price)}</span>
          </button>
        ))}
      </div>
      <p className="note">
        Every booking adds a booking fee, because the barber opens the shop out of hours. The earlier you book, the less it
        is: {fees.map((f) => `${gbp(f.fee)} ${f.minHoursAhead ? `${f.minHoursAhead}+ hours ahead` : "with less notice"}`).join(", ")}.
      </p>
      <button className="btn" disabled={!serviceId} onClick={() => setStep(2)}>Choose a time</button>
    </>
  );

  if (step === 2) return (
    <>
      <Steps n={2} />
      <h2>When can you get here?</h2>
      <p className="lead">Pick an evening, then a time. Leave time to drive and park.</p>
      {error && <p className="err">{error}</p>}
      {nights === null ? <p className="lead">Checking free times…</p> : (
        <>
          <div className="slots">
            {nights.map((n) => (
              <button key={n.key} className="slot" aria-pressed={nightKey === n.key} disabled={!n.slots.length}
                onClick={() => { setNightKey(n.key); setError(""); }}>{n.label}</button>
            ))}
          </div>
          {night?.slots.length ? (
            <div className="slots" style={{ marginTop: 14 }}>
              {night.slots.map((s) => (
                <button key={s.at} className="slot" aria-pressed={slot?.at === s.at} onClick={() => { setSlot(s); setError(""); }}>{fmt(s.at)}</button>
              ))}
            </div>
          ) : (
            <div className="sum"><div className="row"><span>No free slots in the next {advanceDays + 1} evenings. Bookings run 19:00 to midnight with at least an hour&apos;s notice.</span></div></div>
          )}
          {slot && <p className="note">Booking fee {gbp(slot.fee)} ({slot.tierLabel}).</p>}
          {saving && (
            <p className="note">
              <button className="back" style={{ display: "inline", padding: 0, margin: 0 }}
                onClick={() => { setNightKey(saving.night.key); setSlot(saving); }}>
                Book for {forNight(saving.night.label)} from {fmt(saving.at)} and save {gbp(compareFee - saving.fee)}
              </button>
            </p>
          )}
        </>
      )}
      <button className="btn" disabled={!slot} onClick={() => setStep(3)}>Add your details</button>
      <button className="back" onClick={() => setStep(1)}>← Change service</button>
    </>
  );

  if (step === 3) return (
    <>
      <Steps n={3} />
      <h2>Who&apos;s coming in?</h2>
      <p className="lead">We text this number when your barber is confirmed.</p>
      <label className="f" htmlFor="nm">Name</label>
      <input className="t" id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="f" htmlFor="ph">Mobile number</label>
      <input className="t" id="ph" type="tel" autoComplete="tel" placeholder="07700 900123" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={!name.trim() || !phone.trim()} onClick={() => { setError(""); setStep(4); }}>Review request</button>
      <button className="back" onClick={() => setStep(2)}>← Change time</button>
    </>
  );

  return (
    <>
      <Steps n={4} />
      <h2>Request a barber</h2>
      <p className="lead">We hold the total on your card and only charge it when a barber accepts. If nobody can, the hold is released and you pay nothing.</p>
      <div className="sum">
        <div className="row"><span>Time</span><span className="price">{slot && `${nightLabel(slot.at)} ${fmt(slot.at)}`}</span></div>
        <div className="row"><span>Shop</span><span>{shop}</span></div>
        <div className="row"><span>{svc?.name}</span><span className="price">{svc && gbp(svc.price)}</span></div>
        <div className="row"><span>Booking fee<br /><small>{slot?.tierLabel}</small></span><span className="price">{slot && gbp(slot.fee)}</span></div>
        <div className="row total"><span>Total</span><span className="price">{gbp(total)}</span></div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="h3">Before you book</div>
      <ul className="rules">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to these rules and the <a href="/terms" target="_blank" rel="noopener">terms</a>. See how we use your details in
          our <a href="/privacy" target="_blank" rel="noopener">privacy notice</a>.
        </span>
      </label>
      <button className="btn" disabled={busy || !agreed} onClick={pay}>{busy ? "Opening secure payment…" : `Request booking · hold ${gbp(total)}`}</button>
      <button className="back" onClick={() => { setError(""); setStep(3); }}>← Edit details</button>
    </>
  );
}
