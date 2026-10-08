"use client";
import { useEffect, useState } from "react";

type Service = { id: string; name: string; mins: number; price: number };
type Props = { services: Service[]; lateFee: number; shop: string; address: string; maps: string };

const gbp = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

function Steps({ n }: { n: number }) {
  return <div className="steps">{[1, 2, 3, 4].map((i) => <span key={i} className={i <= n ? "on" : ""} />)}</div>;
}

export default function BookingFlow({ services, lateFee, shop, address, maps }: Props) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const svc = services.find((s) => s.id === serviceId);

  const loadSlots = () => {
    setSlots(null);
    fetch("/api/slots").then((r) => r.json()).then((d) => setSlots(d.slots || [])).catch(() => setSlots([]));
  };
  useEffect(() => { if (step === 2) loadSlots(); }, [step]);

  async function pay() {
    setBusy(true); setError("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, slot, name, phone }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.url) { window.location.href = data.url; return; }
    setBusy(false);
    setError(data?.error || "Something went wrong. Check your connection and try again.");
    if (data?.error?.includes("slot")) { setSlot(null); setStep(2); }
  }

  if (step === 1) return (
    <>
      <Steps n={1} />
      <h2>Need a cut in the next hour?</h2>
      <p className="lead">A barber opens {shop} out of hours just for you. Pay now, drive over, and walk straight into the chair.</p>
      <div className="sum">
        <div className="row"><span>Where</span><span>{address}<br /><a href={maps} target="_blank" rel="noopener">Get directions</a></span></div>
        <div className="row"><span>Notice</span><span>At least 1 hour</span></div>
        <div className="row"><span>Late booking fee</span><span className="price">{gbp(lateFee)}</span></div>
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
      <p className="note">Every booking adds a {gbp(lateFee)} late booking fee, because the barber opens the shop out of hours.</p>
      <button className="btn" disabled={!serviceId} onClick={() => setStep(2)}>Choose a time</button>
    </>
  );

  if (step === 2) return (
    <>
      <Steps n={2} />
      <h2>When can you get here?</h2>
      <p className="lead">Earliest slot is one hour from now, latest is midnight. Leave time to drive and park.</p>
      {error && <p className="err">{error}</p>}
      {slots === null ? <p className="lead">Checking free times…</p>
        : slots.length ? (
          <div className="slots">
            {slots.map((t) => (
              <button key={t} className="slot" aria-pressed={slot === t} onClick={() => { setSlot(t); setError(""); }}>{fmt(t)}</button>
            ))}
          </div>
        ) : (
          <div className="sum"><div className="row"><span>No slots left tonight. Late bookings run until midnight with at least an hour&apos;s notice.</span></div></div>
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
      <button className="btn" disabled={!name.trim() || !phone.trim()} onClick={() => { setError(""); setStep(4); }}>Review and pay</button>
      <button className="back" onClick={() => setStep(2)}>← Change time</button>
    </>
  );

  return (
    <>
      <Steps n={4} />
      <h2>Pay to confirm</h2>
      <p className="lead">You pay now. If no barber is free we refund you in full straight away.</p>
      <div className="sum">
        <div className="row"><span>Time</span><span className="price">{slot && fmt(slot)}</span></div>
        <div className="row"><span>Shop</span><span>{shop}</span></div>
        <div className="row"><span>{svc?.name}</span><span className="price">{svc && gbp(svc.price)}</span></div>
        <div className="row"><span>Late booking fee</span><span className="price">{gbp(lateFee)}</span></div>
        <div className="row total"><span>Total</span><span className="price">{svc && gbp(svc.price + lateFee)}</span></div>
      </div>
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={busy} onClick={pay}>{busy ? "Opening secure payment…" : `Pay ${svc && gbp(svc.price + lateFee)}`}</button>
      <button className="back" onClick={() => { setError(""); setStep(3); }}>← Edit details</button>
    </>
  );
}
