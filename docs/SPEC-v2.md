# Emergency Barber v2: shop, home and hotel bookings

**Purpose:** build spec for Claude Code. Lives at `docs/SPEC-v2.md`. Work through the phases at the bottom one at a time.
**Baseline:** `emergency-barber` repo, `main` @ `7f45371` (Next.js 14.2 App Router + TypeScript on Vercel, Supabase Postgres + pg_cron, Stripe Checkout with manual capture, Telegram Bot API, Twilio SMS).
**Decided:** 19 Oct 2026.

Everything that already works (hold → Telegram alert → first tap wins → capture, conditional status updates, idempotency keys, error alerts to the private chat) stays. v2 changes what happens before the hold and how barbers are scheduled.

---

## 1. Three ways to book

| Type | Who | Where the cut happens | How they arrive | Restriction |
|---|---|---|---|---|
| `shop` | Busy professional | FadeMasters Hale, 313 Hale Rd, WA15 8SS | Public site `/`, option "At FadeMasters Hale" | None |
| `home` | Busy professional | Their home or office | Public site `/`, option "At my place" | Must have at least one completed `shop` booking on a verified phone number |
| `hotel` | Concierge, on behalf of a guest | The guest's hotel room | Partner link `/h/[slug]` only, never on the public picker | None (the hotel vouches for the guest) |

The public site's first step is **"Where do you want your cut?"** with two choices. Hotels never see it.

All three types share one `bookings` table, one pricing function, one dispatch engine and one status page.

---

## 2. Pricing

All numbers live in `lib/config.ts`. Prices are calculated **server-side** at checkout and **locked into the Stripe hold**. They never change after the customer pays.

### 2.1 Formula

```
total = service_price + advance_fee + distance_step
```

- `service_price`: skin fade £26, hair + beard £39, premium £65 (unchanged).
- `advance_fee`: replaces the flat £50 late fee, for **every** booking type. Based on the hours between payment and slot start:

| Hours ahead | advance_fee |
|---|---|
| 12 or more | £25 |
| 6 to under 12 | £35 |
| under 6 | £50 |

- `distance_step`: £0 for `shop`. For `home` and `hotel`, based on the **driving time from FadeMasters Hale** to the customer's postcode:

| Drive time from Hale | distance_step |
|---|---|
| up to 5 min | £0 |
| over 5 to 15 min | £5 |
| over 15 to 25 min | £10 |
| over 25 min | £15 |

- **Service area:** `home` and `hotel` are only allowed when the **driving distance** from Hale is 13 miles or less. Outside that, show "Outside our area" and offer the shop.

### 2.2 Full price grid (skin fade, £26)

| Booked ahead | Shop | Home ≤5 min | 5–15 min | 15–25 min | 25 min+ |
|---|---|---|---|---|---|
| 12+ h | £51 | £51 | £56 | £61 | £66 |
| 6–12 h | £61 | £61 | £66 | £71 | £76 |
| under 6 h | £76 | £76 | £81 | £86 | £91 |

### 2.3 Config shape

```ts
export const PRICING = {
  advanceFees: [
    { minHoursAhead: 12, fee: 2500 },
    { minHoursAhead: 6,  fee: 3500 },
    { minHoursAhead: 0,  fee: 5000 },
  ],
  distanceSteps: [
    { maxDriveMinutes: 5,  step: 0 },
    { maxDriveMinutes: 15, step: 500 },
    { maxDriveMinutes: 25, step: 1000 },
    { maxDriveMinutes: Infinity, step: 1500 },
  ],
  maxDriveMiles: 13,
} as const; // pence
```

Hotels can have an optional fixed `distance_step_override` on their `hotels` row. If set, it replaces the drive-time step for that hotel.

### 2.4 Pricing function

One pure function, unit tested, used by both the quote endpoint and checkout:

```ts
quote({ serviceId, locationType, slotAt, now, driveMinutes?, driveMiles?, hotel? })
  => { servicePrice, advanceFee, distanceStep, total, tier, outOfArea }
```

Show the breakdown on the review step: service, booking fee (with "booked 12h+ ahead" label), travel (mobile only), total. On the time step, show the cheaper option when it exists, e.g. "Book for tomorrow and save £25".

---

## 3. Booking window

- Bookings allowed for **today plus the next 6 days** (Stripe holds expire after 7 days).
- Nightly window stays **19:00 to midnight** London time, 15-minute slots. Latest start time is midnight for every type. A barber's drive home is outside the window.
- **Minimum notice: 60 minutes** for every type.
- The time step becomes **date picker + slots for that date**. Keep the existing BST/GMT handling and the "after midnight still counts as last night until 06:00" rule.

### 3.1 Preferred barber step

Comes **after the time step**, for every booking type.

**Question 1:** "Do you have a preferred barber?"
- No preference (default)
- One option per name in `BARBER_NAMES` (Karo, Joe, Oscar)

**Question 2** (only if a barber was chosen): "If [name] isn't available, are you happy to go with another barber?"
- Yes, any barber is fine (default)
- No, only [name]

For `home` bookings, pre-select the barber from the customer's last completed booking (`customers.last_barber`). The customer can still change it.

Store on the booking: `preferred_barber` (null = no preference) and `allow_fallback` (boolean, true when no preference).

**How dispatch uses it** (see §11 for timings):

| Choice | Telegram alert | If the preferred barber doesn't accept in time |
|---|---|---|
| No preference | Group alert, all barbers' buttons (as today) | Normal re-ping and release |
| Preferred + fallback yes | Group alert headed "Requested: Joe", **only Joe's button** plus "Joe can't" | Alert is edited to show every barber's button, then normal re-ping and release |
| Preferred + fallback no | Group alert headed "Requested: Joe only", **only Joe's button** plus "Joe can't" | Hold released, customer texted "Joe isn't available, you haven't been charged" with a link to rebook with any barber |

- "Joe can't" ends the exclusive window straight away (opens to all, or releases if no fallback).
- Only the preferred barber's tap counts during the exclusive window.
- The status page and SMS say who was requested and, once accepted, who's coming. If a different barber accepts, say so clearly: "Joe wasn't free, Oscar is cutting you instead".
- Phase 2 barber availability (`/on` `/off`) isn't built yet, so the app can't tell at booking time whether the preferred barber is working. Until then the exclusive window is the check. Once availability exists, hide or grey out barbers who are off for the chosen slot.

---

## 4. Availability and capacity (replaces the one-booking-per-slot index)

The current partial unique index on `slot_at` allows one booking per 15-minute slot. That breaks once home visits run in parallel and services have different lengths. Replace it with a capacity check.

### 4.1 How long a booking blocks a barber

| Type | Blocks from | Blocks until |
|---|---|---|
| `shop` | `slot_at` | `slot_at + service_minutes` |
| `home` / `hotel` | `slot_at − drive_minutes` | `slot_at + service_minutes + drive_minutes` |

Service minutes: skin fade 40, hair + beard 55, premium 75 (already in config). `drive_minutes` is the drive time from Hale, stored on the booking. Store `block_start` and `block_end` on each row.

### 4.2 Rules

Config: `BARBER_COUNT = 3`, `SHOP_CHAIRS = 1` (set to 2 if two chairs get used).

For a candidate booking, count active bookings (`pending`, `new`, `confirmed`, `on_the_way`, `arrived`) whose block overlaps it:

- **Shop booking** is allowed if: overlapping shop bookings < `SHOP_CHAIRS` **and** overlapping bookings of any type < `BARBER_COUNT`.
- **Home / hotel booking** is allowed if: overlapping bookings of any type ≤ `BARBER_COUNT − 2`. That always leaves one barber free for the shop (**shop gets priority**). With `BARBER_COUNT = 3` this means at most **2 mobile bookings can overlap** at any moment. This cap is intentional; raise `BARBER_COUNT` to allow more.

### 4.3 No race conditions

Do the check and insert inside a single Postgres function, e.g. `reserve_booking(...)`, that takes `pg_advisory_xact_lock` on a fixed key, counts overlaps, and inserts or raises. Call it from `/api/checkout` via Supabase RPC. Keep the re-check before insert. Remove the old unique index in the same migration.

`/api/slots` uses the same overlap logic (read-only) to hide slots that would fail, given the chosen type, service and, for mobile, the drive time.

---

## 5. Location, drive time and ETA

### 5.1 Postcode → coordinates

[postcodes.io](https://postcodes.io) (free, no key): validate the postcode and get latitude/longitude.

### 5.2 Drive time and distance

Use one routing API behind a small wrapper `lib/routing.ts`:

```ts
driveBetween(from: LatLng, to: LatLng) => { minutes, miles }
```

Options: Google Routes API (`computeRoutes`, monthly free allowance) or OpenRouteService (free tier). Env var `ROUTING_API_KEY`. Cache results per postcode in a `drive_cache` table (postcode, minutes, miles, fetched_at) for 30 days to save calls.

**Pricing and the service-area check always use Hale → customer**, so the price doesn't depend on which barber accepts.

### 5.3 Two-stage ETA for mobile bookings

1. **At booking:** status page and SMS show an estimate based on Hale, e.g. "Your barber will arrive around 21:15".
2. **After a barber accepts:** the bot sends that barber a **private message** with a "Share my location" button. Telegram only allows location-request buttons in private chats, so each barber must have pressed Start on the bot once. When the location arrives, call `driveBetween(barber, customer)` and text the customer an updated ETA. If no location arrives within 5 minutes, keep the Hale estimate.

---

## 6. Customers table and the home-visit rule

### 6.1 Table

```sql
create table customers (
  phone text primary key,            -- normalised +44
  name text,
  completed_shop_visits int not null default 0,
  last_barber text,                  -- barber on their last done booking
  home_allowed boolean not null default false,
  blocked boolean not null default false,
  notes text,                        -- private, admin only
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

- When a **shop** booking moves to `done`: upsert the customer, `completed_shop_visits += 1`, set `home_allowed = true`.
- Home visits are open to everyone with a verified number (opened up 2026-10-23); `home_allowed` is no longer checked.
- `blocked = true`: no home visits for that number.
- `/admin` can toggle `blocked` and edit `notes`.

### 6.2 Home flow gate

1. Customer chooses "At my place".
2. Enter mobile → send a 6-digit code with **Twilio Verify** (env `TWILIO_VERIFY_SERVICE_SID`). This stops anyone using a regular's number.
3. After a correct code, look up `customers`:
   - not `blocked` (including numbers we've never seen) → continue to address.
   - blocked → say we can't book a home visit for this number, with a button to the shop flow.
4. Save a short-lived signed token (cookie, 30 min) proving the phone was verified. `/api/checkout` must check it for `home` bookings, never trust the client.


### 6.3 Making sure "done" happens

Shop bookings only count once marked `done`. Add a **Done** button to the Telegram alert for confirmed shop bookings. Also have the cron nudge the assigned barber 30 minutes after the expected finish if it's still `confirmed`.

---

## 7. Hotels

### 7.1 Table

```sql
create table hotels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,         -- /h/[slug]
  name text not null,
  address text not null,
  postcode text not null,
  lat double precision, lng double precision,
  drive_minutes int, drive_miles numeric,   -- from Hale, cached
  arrival_notes text,                -- e.g. "report to front desk"
  contact_name text, contact_phone text, contact_email text,
  distance_step_override int,        -- pence, optional
  active boolean not null default true,
  created_at timestamptz default now()
);
```

Create and edit hotels from `/admin`.

### 7.2 Hotel flow (`/h/[slug]`)

1. Header shows the hotel name. No location step, no address entry, no customer check.
2. Service → date and time.
3. Concierge details: name and mobile (receives the texts).
4. Guest details: guest name and room number.
5. Review → Stripe hold on the concierge's card (the hotel pays). Later, move regular hotels to monthly invoicing.

The Telegram alert includes the hotel name, guest name, room and `arrival_notes`.

---

## 8. Booking statuses

Add three statuses for mobile bookings and one for no-shows:

| Status | Used by | Meaning | Holds capacity |
|---|---|---|---|
| `pending` | all | On Stripe Checkout | yes |
| `new` | all | Card held, waiting for a barber | yes |
| `confirmed` | all | Barber accepted, card charged | yes |
| `on_the_way` | home, hotel | Barber tapped "On my way" | yes |
| `arrived` | home, hotel | Barber tapped "Arrived" | yes |
| `done` | all | Cut finished | no |
| `no_show` | all | Customer didn't turn up or answer | no |
| `refunded` / `cancelled` / `expired` | all | Unchanged | no |

Keep every transition as a conditional update on the expected current status, like today.

---

## 9. Telegram buttons

**Shop:** Accept (per barber) / Nobody free → **Done** → (or **No-show**).

**Home and hotel:** Accept (per barber) / Nobody free → **On my way** → **Arrived** → **Done**, with **No-show** available after Arrived.

Only the assigned barber's taps are accepted after Accept.

### 9.1 Safety check-out (home and hotel)

- **Arrived** records `arrived_at`.
- After **Done** the barber taps **Left safely**, which records `left_at`.
- If `left_at` is empty 30 minutes after `arrived_at + service_minutes`, the cron sends Karo an alert in the private chat with the barber, address and phone.

---

## 10. Cancellation and no-show rules

### 10.1 Shop (same as today, with the new fee name)

| When | Customer gets back |
|---|---|
| Before a barber accepts | Everything (hold released) |
| Confirmed, 30+ min before slot | Service price (booking fee kept) |
| Confirmed, under 30 min | Nothing |

### 10.2 Home and hotel

| When | Customer gets back |
|---|---|
| Before a barber accepts | Everything (hold released) |
| Confirmed, barber not yet "On my way" | Service price (booking fee and travel kept) |
| After "On my way" | Nothing |

### 10.3 No-show (home and hotel)

1. Barber taps **Arrived**. The app texts the customer (for hotels, the concierge) "Your barber is here".
2. The barber calls twice.
3. **No-show** only becomes available 15 minutes after `arrived_at`. Tapping it sets `no_show`, keeps the full charge and texts the customer.

For shop bookings, **No-show** becomes available 15 minutes after `slot_at`.

Update the rules text in `lib/config.ts`, the tick-box copy, `/terms`, `/refunds`, the status page and the texts. The rules shown must match the booking type.

---

## 11. Dispatch timing by how far ahead

| Booked | Re-ping group | Release hold if unclaimed |
|---|---|---|
| under 6 h ahead | 10 min | 20 min (as today) |
| 6 h+ ahead | 2 hours | 12 hours, but never later than 2 hours before the slot |

Compute the release time once, when the hold succeeds, and store it on the booking as `release_at`: for under 6 h, `paid_at + 20 min`; for 6 h+, `min(paid_at + 12 h, slot_at − 2 h)`. The cron releases any `new` booking whose `release_at` has passed, instead of working the rule out each run. Backfill existing `new` rows with `paid_at + 20 min`.

Show it on the status page from `release_at`, e.g. "We'll confirm your barber by 21:00 tonight".

**Preferred barber window** (when `preferred_barber` is set): the preferred barber gets an exclusive window first, which counts towards the times above.

| Booked | Exclusive window for the preferred barber |
|---|---|
| under 6 h ahead | 7 min |
| 6 h+ ahead | 1 hour |

After the window: if `allow_fallback`, open the alert to all barbers and carry on with the normal re-ping and release. If not, release the hold.

---

## 12. Schema changes to `bookings`

```sql
alter table bookings
  add column location_type text not null default 'shop'
    check (location_type in ('shop','home','hotel')),
  add column hotel_id uuid references hotels(id),
  add column address text,
  add column postcode text,
  add column lat double precision,
  add column lng double precision,
  add column drive_minutes int,
  add column drive_miles numeric,
  add column block_start timestamptz,
  add column block_end timestamptz,
  add column guest_name text,
  add column room text,
  add column booker_name text,
  add column booker_phone text,
  add column service_price int,
  add column advance_fee int,
  add column distance_step int,
  add column price_tier text,          -- '12h', '6h', 'standard'
  add column preferred_barber text,     -- null = no preference
  add column allow_fallback boolean not null default true,
  add column exclusive_until timestamptz,
  add column release_at timestamptz,    -- when the cron releases an unclaimed hold (§11)
  add column eta_at timestamptz,
  add column on_the_way_at timestamptz,
  add column arrived_at timestamptz,
  add column left_at timestamptz;
```

Extend the status check constraint with `on_the_way`, `arrived`, `no_show`. Backfill existing rows: `location_type = 'shop'`, `advance_fee = 5000`, `block_start/block_end` from `slot_at` and service minutes. Write it as a new dated migration in `supabase/`.

---

## 13. New environment variables

`ROUTING_API_KEY`, `TWILIO_VERIFY_SERVICE_SID`, `VERIFY_TOKEN_SECRET`, `BARBER_COUNT`, `SHOP_CHAIRS`, `ADVANCE_DAYS` (= 6). Add them to `.env.example`.

---

## 14. Build phases

Do one phase per Claude Code session. Each ends with tests passing, a deploy to the preview URL, and a manual run-through in Stripe test mode.

### Phase 1: Pricing engine and booking ahead (shop only)
- `lib/pricing.ts` with `quote()` and unit tests covering every grid cell in §2.2 and the tier boundaries (exactly 6 h and 12 h ahead).
- Date picker, 6 days ahead, slots per date.
- Replace the flat £50 fee everywhere with the advance fee, including rules text.
- Dispatch timing by advance (§11), with the cron releasing holds by `release_at`.
- Store `service_price`, `advance_fee`, `price_tier`, `release_at` on bookings.

> Prompt: *"Read docs/SPEC-v2.md. Implement Phase 1 only: sections 2 (shop part), 3 and 11. Start with lib/pricing.ts and its tests, then the migration, then the UI. Don't touch home or hotel yet."*

### Phase 2: Capacity model
- Migration: `block_start`/`block_end`, drop the unique slot index, add `reserve_booking()` with the advisory lock (§4).
- `/api/slots` and `/api/checkout` use the overlap rules.
- Tests: overlapping premium cuts, the shop-priority rule, two concurrent checkouts for the last place.

### Phase 3a: Customers table, Done and No-show for shop
- `customers` table, upsert on `done` (§6.1). Set `customers.last_barber` on `done`.
- Telegram **Done** and **No-show** buttons for shop bookings, plus the cron nudge (§6.3).
- `/admin`: customer list with `blocked`, `notes`.

### Phase 3b: Preferred barber
- Preferred barber step after the time step (§3.1).
- Exclusive dispatch window: alert with only the preferred barber's button plus "[name] can't", `exclusive_until`, then open to all or release depending on `allow_fallback` (§3.1, §11).
- Status page and SMS copy for requested vs. accepted barber, and the "not available, rebook with any barber" text.
- Tests: preferred barber accepts in the window, another barber's tap is ignored in the window, "can't" with and without fallback, window expiry with and without fallback.

### Phase 4: Home visits
- Location step on `/`.
- Twilio Verify gate and signed token (§6.2).
- Address step, postcodes.io, `lib/routing.ts`, `drive_cache`, 13-mile check, distance steps.
- New statuses and the mobile button sequence (§8, §9), safety check-out alert (§9.1).
- Mobile cancellation and no-show rules (§10.2, §10.3).

### Phase 5: Live ETA

> **On hold (20 Oct 2026).** Not built. Mobile ETAs use the Hale estimate from §5.3 step 1 until this is picked up again.

- Private-message location request to the accepting barber, ETA recalculation and SMS (§5.3).

### Phase 6: Hotels
- `hotels` table and `/admin` editor.
- `/h/[slug]` flow, concierge and guest fields, hotel details in the Telegram alert (§7).

---

## 15. Still to decide (not blocking Phases 1 to 3)

- FadeMasters owner agreement (out-of-hours use, name, what the owner gets per booking).
- Barber pay split for service price, booking fee and travel.
- Insurance cover for mobile work (hotels will ask for a certificate).
- Hotel commission, if any.
- Optional tips after the cut.
- Twilio UK sender: needed before Verify and real texts work.
