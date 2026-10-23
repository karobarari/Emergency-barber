"use client";
import { useEffect, useState } from "react";

type Service = { id: string; name: string; mins: number; price: number };
type Fee = { minHoursAhead: number; fee: number };
type Slot = { at: string; fee: number; tierLabel: string; travel?: number };
type Night = { key: string; label: string; slots: Slot[] };
type Area = { postcode: string; driveMinutes: number; driveMiles: number; distanceStep: number };
type Hotel = { slug: string; name: string; travel: number; driveMinutes: number };
type Props = {
  services: Service[]; fees: Fee[]; advanceDays: number; shop: string; address: string; maps: string;
  rules: string[]; homeRules: string[]; barbers: string[]; homeEnabled: boolean;
  /** Set on a hotel's partner link (/h/[slug]): no location step, and the concierge books for a guest. */
  hotel?: Hotel;
};

const gbp = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * Shop bookings skip the phone check and address. Home visits check the phone first (SPEC-v2 §6.2). Hotels skip
 * the location step and add the guest's details (§7.2).
 */
const FLOWS = {
  shop: ["where", "service", "time", "barber", "details", "review"],
  home: ["where", "phone", "address", "service", "time", "barber", "details", "review"],
  hotel: ["service", "time", "barber", "details", "guest", "review"],
} as const;
type Mode = keyof typeof FLOWS;
type Step = (typeof FLOWS)[Mode][number];

function Steps({ n, of }: { n: number; of: number }) {
  return <div className="steps">{Array.from({ length: of }, (_, i) => <span key={i} className={i <= n ? "on" : ""} />)}</div>;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
    .catch(() => ({ ok: false, data: { error: "Something went wrong. Check your connection and try again." } }));

export default function BookingFlow({ services, fees, advanceDays, shop, address, maps, rules, homeRules, barbers, homeEnabled, hotel }: Props) {
  const [mode, setMode] = useState<Mode>(hotel ? "hotel" : "shop");
  const [at, setAt] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [nights, setNights] = useState<Night[] | null>(null);
  const [nightKey, setNightKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [preferred, setPreferred] = useState<string | null>(null); // null = no preference
  const [allowFallback, setAllowFallback] = useState(true);
  // Home visits
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [locked, setLocked] = useState(false); // verified, but this number is blocked from home visits
  const [street, setStreet] = useState("");
  const [postcode, setPostcode] = useState("");
  const [area, setArea] = useState<Area | null>(null);
  const [outOfArea, setOutOfArea] = useState(false);
  // Hotels
  const [guestName, setGuestName] = useState("");
  const [room, setRoom] = useState("");

  const flow: readonly Step[] = FLOWS[mode];
  const step: Step = flow[at];
  const go = (s: Step) => { setError(""); setAt(flow.indexOf(s)); };
  const next = () => { setError(""); setAt((i) => i + 1); };
  const back = () => { setError(""); setAt((i) => i - 1); };
  const toShop = () => { setMode("shop"); setLocked(false); setOutOfArea(false); setError(""); setAt(1); };
  const home = mode === "home";
  const atHotel = mode === "hotel";

  const svc = services.find((s) => s.id === serviceId);
  const travel = slot?.travel ?? 0;
  const total = svc && slot ? svc.price + slot.fee + travel : 0;
  const cheapest = Math.min(...fees.map((f) => f.fee));
  const dearest = Math.max(...fees.map((f) => f.fee));
  const shownRules = mode === "shop" ? rules : homeRules;

  const loadSlots = () => {
    setNights(null);
    // Longer services need more free time after the slot, and visits also block the drive, so the list depends on both.
    const where = hotel ? `&type=hotel&hotel=${hotel.slug}`
      : home && area ? `&type=home&postcode=${encodeURIComponent(area.postcode)}` : "";
    fetch(`/api/slots?service=${serviceId}${where}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) setError(d.error || "Couldn't load free times.");
        const list: Night[] = d.nights || [];
        setNights(list);
        // Keep the picked slot only if it still has room for this service, with its latest fee.
        setSlot((s) => list.flatMap((n) => n.slots).find((x) => x.at === s?.at) ?? null);
        // Stay on the chosen evening if it still has slots, otherwise jump to the first one that does.
        setNightKey((k) => (list.find((n) => n.key === k && n.slots.length) ?? list.find((n) => n.slots.length))?.key ?? null);
      })
      .catch(() => setNights([]));
  };
  useEffect(() => { if (step === "time") loadSlots(); }, [step]);

  const night = nights?.find((n) => n.key === nightKey);
  const nightLabel = (iso: string) => nights?.find((n) => n.slots.some((s) => s.at === iso))?.label ?? "";

  // The cheaper option, if there is one: the earliest slot with a lower booking fee than the one picked (or the first free one).
  const all = nights?.flatMap((n) => n.slots.map((s) => ({ ...s, night: n }))) ?? [];
  const compareFee = slot?.fee ?? all[0]?.fee ?? 0;
  const lowestFee = Math.min(...all.map((s) => s.fee));
  const saving = all.find((s) => s.fee === lowestFee && s.fee < compareFee);
  // "Book for tomorrow", but "Book for Wed 21 Oct".
  const forNight = (label: string) => (/^To/.test(label) ? label.toLowerCase() : label);

  async function sendCode() {
    setBusy(true); setError("");
    const r = await post("/api/verify/start", { phone });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "Couldn't send the code.");
    setCodeSent(true);
  }

  async function checkCode() {
    setBusy(true); setError("");
    const r = await post("/api/verify/check", { phone, code });
    setBusy(false);
    if (!r.ok) return setError(r.data.error || "Couldn't check the code.");
    if (!r.data.allowed) return setLocked(true);
    if (r.data.name && !name) setName(r.data.name);
    // Pre-select the barber from their last cut; they can still change it.
    if (r.data.lastBarber && barbers.includes(r.data.lastBarber)) setPreferred(r.data.lastBarber);
    next();
  }

  async function checkArea() {
    setBusy(true); setError(""); setOutOfArea(false);
    const r = await fetch(`/api/area?postcode=${encodeURIComponent(postcode)}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, data: { error: "Something went wrong. Check your connection and try again." } }));
    setBusy(false);
    if (!r.ok) {
      setArea(null);
      setOutOfArea(!!r.data.outOfArea);
      // The 30-minute phone check ran out: start that step again.
      if (r.data.error?.includes("number needs checking")) { setCodeSent(false); setCode(""); go("phone"); }
      return setError(r.data.error || "Couldn't check that postcode.");
    }
    setArea(r.data);
    setPostcode(r.data.postcode);
  }

  async function pay() {
    if (!slot) return;
    setBusy(true); setError("");
    const r = await post("/api/checkout", {
      serviceId, slot: slot.at, name, phone, agreed, expectedTotal: total, preferredBarber: preferred, allowFallback,
      ...(home ? { locationType: "home", address: street, postcode: area?.postcode } : {}),
      ...(hotel ? { locationType: "hotel", hotel: hotel.slug, guestName, room } : {}),
    });
    if (r.data?.url) { window.location.href = r.data.url; return; }
    setBusy(false);
    setError(r.data?.error || "Something went wrong. Check your connection and try again.");
    // The booking fee went up since the slot list loaded. Show the new price and let them decide.
    if (r.data?.quote) setSlot({ ...slot, fee: r.data.quote.fee, tierLabel: r.data.quote.tierLabel });
    else if (r.data?.error?.includes("slot")) { setSlot(null); go("time"); }
  }

  const head = <Steps n={at} of={flow.length} />;

  if (step === "where") return (
    <>
      {head}
      <h2>Need a cut out of hours?</h2>
      <p className="lead">Tonight or up to {advanceDays} days ahead. Send a request, and pay only when a barber accepts.</p>
      <label className="f">Where do you want your cut?</label>
      <div className="opts">
        <button className="opt" aria-pressed={mode === "shop"} onClick={() => setMode("shop")}>
          <span><b>At {shop}</b><small>A barber opens the shop just for you</small></span>
        </button>
        <button className="opt" aria-pressed={mode === "home"} disabled={!homeEnabled} onClick={() => setMode("home")}>
          <span>
            <b>At my place</b>
            <small>{homeEnabled ? "Your home or office" : "Coming soon"}</small>
          </span>
        </button>
      </div>
      <button className="btn" onClick={next}>Continue</button>
    </>
  );

  if (step === "phone") return (
    <>
      {head}
      <h2>{locked ? "We can't come to you" : "Check your number"}</h2>
      {locked ? (
        <>
          <p className="lead">We can&apos;t book a home visit for this number. You can still book a cut at {shop}.</p>
          <button className="btn" onClick={toShop}>Book at the shop</button>
        </>
      ) : (
        <>
          <p className="lead">We&apos;ll text a code to check it&apos;s you.</p>
          <label className="f" htmlFor="ph">Mobile number</label>
          <input className="t" id="ph" type="tel" autoComplete="tel" placeholder="07700 900123" value={phone}
            onChange={(e) => { setPhone(e.target.value); setCodeSent(false); }} />
          {codeSent && (
            <>
              <label className="f" htmlFor="code">6-digit code</label>
              <input className="t" id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </>
          )}
          {error && <p className="err">{error}</p>}
          {codeSent
            ? <button className="btn" disabled={busy || code.length !== 6} onClick={checkCode}>{busy ? "Checking…" : "Check code"}</button>
            : <button className="btn" disabled={busy || !phone.trim()} onClick={sendCode}>{busy ? "Sending…" : "Text me a code"}</button>}
          {codeSent && <button className="back" onClick={sendCode} disabled={busy}>Send a new code</button>}
        </>
      )}
      <button className="back" onClick={() => { setLocked(false); back(); }}>← Back</button>
    </>
  );

  if (step === "address") return (
    <>
      {head}
      <h2>Where should the barber come?</h2>
      <p className="lead">Travel is priced on the drive from {shop}. We cover up to 13 miles.</p>
      <label className="f" htmlFor="st">First line of address</label>
      <input className="t" id="st" autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} />
      <label className="f" htmlFor="pc">Postcode</label>
      <input className="t" id="pc" autoComplete="postal-code" value={postcode}
        onChange={(e) => { setPostcode(e.target.value); setArea(null); setOutOfArea(false); }} />
      {error && <p className="err">{error}</p>}
      {area && (
        <div className="sum" style={{ marginTop: 14 }}>
          <div className="row"><span>Drive from the shop</span><span>about {area.driveMinutes} min</span></div>
          <div className="row"><span>Travel</span><span className="price">{area.distanceStep ? gbp(area.distanceStep) : "Free"}</span></div>
        </div>
      )}
      {outOfArea && <button className="btn ghost" onClick={toShop}>Book at the shop instead</button>}
      {area
        ? <button className="btn" disabled={!street.trim()} onClick={next}>Choose a service</button>
        : <button className="btn" disabled={busy || !postcode.trim()} onClick={checkArea}>{busy ? "Checking…" : "Check postcode"}</button>}
      <button className="back" onClick={back}>← Back</button>
    </>
  );

  if (step === "service") return (
    <>
      {head}
      <h2>{hotel ? `Book a cut for a guest at ${hotel.name}` : "What do you need?"}</h2>
      {hotel && (
        <p className="lead">
          A barber comes to the guest&apos;s room, tonight or up to {advanceDays} days ahead. The hold goes on your card and is
          only charged once a barber accepts. {hotel.travel ? `Travel adds ${gbp(hotel.travel)}.` : ""}
        </p>
      )}
      {mode === "shop" && (
        <div className="sum">
          <div className="row"><span>Where</span><span>{address}<br /><a href={maps} target="_blank" rel="noopener">Get directions</a></span></div>
          <div className="row"><span>When</span><span>19:00 to midnight, at least 1 hour&apos;s notice</span></div>
          <div className="row"><span>Booking fee</span><span className="price">{gbp(cheapest)}–{gbp(dearest)}</span></div>
        </div>
      )}
      <div className="opts" style={{ marginTop: 14 }}>
        {services.map((s) => (
          <button key={s.id} className="opt" aria-pressed={serviceId === s.id} onClick={() => setServiceId(s.id)}>
            <span><b>{s.name}</b><small>about {s.mins} min</small></span>
            <span className="price">{gbp(s.price)}</span>
          </button>
        ))}
      </div>
      <p className="note">
        Every booking adds a booking fee, because the barber works out of hours. The earlier you book, the less it
        is: {fees.map((f) => `${gbp(f.fee)} ${f.minHoursAhead ? `${f.minHoursAhead}+ hours ahead` : "with less notice"}`).join(", ")}.
        {home && area?.distanceStep ? ` Travel adds ${gbp(area.distanceStep)}.` : ""}
      </p>
      <button className="btn" disabled={!serviceId} onClick={next}>Choose a time</button>
      {at > 0 && <button className="back" onClick={back}>← Back</button>}
    </>
  );

  if (step === "time") return (
    <>
      {head}
      <h2>{mode === "shop" ? "When can you get here?" : "When should the barber arrive?"}</h2>
      <p className="lead">{mode === "shop" ? "Pick an evening, then a time. Leave time to drive and park." : "Pick an evening, then a time."}</p>
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
      <button className="btn" disabled={!slot} onClick={next}>Choose a barber</button>
      <button className="back" onClick={back}>← Change service</button>
    </>
  );

  if (step === "barber") return (
    <>
      {head}
      <h2>Do you have a preferred barber?</h2>
      <p className="lead">We ask them first. You&apos;re only charged once a barber accepts.</p>
      <div className="opts">
        <button className="opt" aria-pressed={preferred === null} onClick={() => { setPreferred(null); setAllowFallback(true); }}>
          <span><b>No preference</b><small>Whoever&apos;s free first</small></span>
        </button>
        {barbers.map((n) => (
          <button key={n} className="opt" aria-pressed={preferred === n} onClick={() => setPreferred(n)}>
            <span><b>{n}</b></span>
          </button>
        ))}
      </div>
      {preferred && (
        <>
          <label className="f">If {preferred} isn&apos;t available, are you happy to go with another barber?</label>
          <div className="opts">
            <button className="opt" aria-pressed={allowFallback} onClick={() => setAllowFallback(true)}>
              <span><b>Yes, any barber is fine</b><small>We ask {preferred} first, then the others</small></span>
            </button>
            <button className="opt" aria-pressed={!allowFallback} onClick={() => setAllowFallback(false)}>
              <span><b>No, only {preferred}</b><small>If {preferred} can&apos;t, the hold is released and you pay nothing</small></span>
            </button>
          </div>
        </>
      )}
      <button className="btn" onClick={next}>Add your details</button>
      <button className="back" onClick={back}>← Change time</button>
    </>
  );

  if (step === "details") return (
    <>
      {head}
      <h2>{atHotel ? "Your details" : home ? "Who's having the cut?" : "Who's coming in?"}</h2>
      <p className="lead">
        {atHotel ? "We text this number when a barber accepts, sets off and arrives, so it's best on the desk's mobile."
          : home ? `We text ${phone} when your barber is confirmed and on the way.` : "We text this number when your barber is confirmed."}
      </p>
      <label className="f" htmlFor="nm">Name</label>
      <input className="t" id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      {!home && (
        <>
          <label className="f" htmlFor="ph">Mobile number</label>
          <input className="t" id="ph" type="tel" autoComplete="tel" placeholder="07700 900123" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </>
      )}
      {error && <p className="err">{error}</p>}
      <button className="btn" disabled={!name.trim() || !phone.trim()} onClick={next}>{atHotel ? "Add the guest" : "Review request"}</button>
      <button className="back" onClick={back}>← Change barber</button>
    </>
  );

  if (step === "guest") return (
    <>
      {head}
      <h2>Who&apos;s the guest?</h2>
      <p className="lead">The barber goes to the room and asks for the guest by name.</p>
      <label className="f" htmlFor="gn">Guest&apos;s name</label>
      <input className="t" id="gn" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
      <label className="f" htmlFor="rm">Room number</label>
      <input className="t" id="rm" value={room} onChange={(e) => setRoom(e.target.value)} />
      <button className="btn" disabled={!guestName.trim() || !room.trim()} onClick={next}>Review request</button>
      <button className="back" onClick={back}>← Your details</button>
    </>
  );

  return (
    <>
      {head}
      <h2>Request a barber</h2>
      <p className="lead">We hold the total on your card and only charge it when a barber accepts. If nobody can, the hold is released and you pay nothing.</p>
      <div className="sum">
        <div className="row"><span>Time</span><span className="price">{slot && `${nightLabel(slot.at)} ${fmt(slot.at)}`}</span></div>
        <div className="row"><span>Where</span><span>{hotel ? `${hotel.name}, room ${room}` : home ? `${street}, ${area?.postcode}` : shop}</span></div>
        {atHotel && <div className="row"><span>Guest</span><span>{guestName}</span></div>}
        <div className="row"><span>Barber</span><span>{preferred ? `${preferred}${allowFallback ? ", or another if they can't" : " only"}` : "No preference"}</span></div>
        <div className="row"><span>{svc?.name}</span><span className="price">{svc && gbp(svc.price)}</span></div>
        <div className="row"><span>Booking fee<br /><small>{slot?.tierLabel}</small></span><span className="price">{slot && gbp(slot.fee)}</span></div>
        {mode !== "shop" && (
          <div className="row">
            <span>Travel<br /><small>about {hotel?.driveMinutes ?? area?.driveMinutes} min from the shop</small></span>
            <span className="price">{travel ? gbp(travel) : "Free"}</span>
          </div>
        )}
        <div className="row total"><span>Total</span><span className="price">{gbp(total)}</span></div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="h3">Before you book</div>
      <ul className="rules">{shownRules.map((r) => <li key={r}>{r}</li>)}</ul>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to these rules and the <a href="/terms" target="_blank" rel="noopener">terms</a>. See how we use your details in
          our <a href="/privacy" target="_blank" rel="noopener">privacy notice</a>.
        </span>
      </label>
      <button className="btn" disabled={busy || !agreed} onClick={pay}>{busy ? "Opening secure payment…" : `Request booking · hold ${gbp(total)}`}</button>
      <button className="back" onClick={back}>← Edit details</button>
    </>
  );
}
