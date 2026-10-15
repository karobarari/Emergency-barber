# Emergency Barber Roadmap

Oct 13, 2026 · @karo

## What's already built

The MVP in emergency-barber.zip handles one evening end to end: book, pay, dispatch to a barber, text the customer, refund if nobody's free. It type-checks, builds, and the slot rules were tested across summer and winter time. It is deployed to Vercel and connected to Supabase, Stripe (test mode) and Telegram.

**Stack:** Next.js 14.2.35 (App Router, TypeScript) · Supabase Postgres · Stripe Checkout · Telegram bot · Twilio SMS · Vercel.

| File | What it does |
| --- | --- |
| `app/page.tsx` + `app/components/BookingFlow.tsx` | 4-step customer flow: service → time slot → name and UK mobile → review and pay. Shows address, directions link and the £50 late fee. |
| `app/booking/[id]/page.tsx` | Customer status page after payment. Auto-refreshes every 15s: paid → barber confirmed → in the chair, or refunded. |
| `app/admin/page.tsx` + `middleware.ts` | Password-protected dispatch board. Tonight's jobs, assign / refund / mark done, takings total, refreshes every 20s. |
| `app/api/slots/route.ts` | Returns tonight's free slots. |
| `app/api/checkout/route.ts` | Validates the request, re-checks the slot, saves a pending booking, opens Stripe Checkout (expires after 30 min to free the slot). |
| `app/api/stripe/webhook/route.ts` | Marks bookings paid on success, expired on abandonment. Verifies Stripe's signature. |
| `app/api/telegram/route.ts` | Handles barbers tapping Assign or Refund in the Telegram group. Checks the secret and the group id. |
| `lib/bookings.ts` | Status changes (pending → new → confirmed → done / refunded). First tap wins, so two barbers can't take the same job. |
| `lib/slots.ts` | Slot rules: 15-min steps, 1 hour's notice, from `OPEN_FROM` to midnight, London time with BST/GMT handled. |
| `lib/telegram.ts` | Sends and updates the group alert with a button per barber and a refund button. |
| `lib/sms.ts` | Twilio texts and UK mobile validation. Logs instead of sending when Twilio isn't set up. |
| `lib/config.ts` | Shop details, services and prices (£26 / £39 / £65), £50 late fee, barber names. |
| `lib/supabase.ts`, `lib/stripe.ts`, `lib/taken.ts` | Database and Stripe clients; removes booked slots from the free list. |
| `supabase/schema.sql` | `bookings` table, one-booking-per-slot unique index, row-level security on. |
| `app/layout.tsx`, `app/globals.css` | Header, fonts and the prototype's styling ported over. |
| `.env.example`, `README.md` | Every setting explained; 30-minute setup guide, go-live checklist, and what's deliberately not built. |

Alongside the code, the **Manchester one-pager** sets the offer, target users, pricing, the cancellation rules and drive-time zones. Those cancellation rules are written down but **not yet in the code**.

## Phase 0: Get the MVP live (week 1)

No new features. The goal is one real paid booking going through end to end.

- [ ] Agree out-of-hours use with the FadeMasters owner: keys, alarm code, and insurance cover while the shop is closed
- [ ] Set `OPEN_FROM` to the shop's real closing time
- [x] Replace `Barber 2` and `Barber 3` in `BARBER_NAMES` with the two lads' names (Joe, Oscar)
- [x] Put the code in a GitHub repo
- [x] Create Supabase project and run `schema.sql`
- [x] Stripe in test mode, webhook connected
- [x] Telegram bot and barbers' group, webhook registered
- [x] Deploy to Vercel: live at emergency-barber.vercel.app, auto-deploys from `main`
- [ ] Custom domain
- [ ] Full test run with card 4242 4242 4242 4242: booking → alert → assign → status page
- [ ] Twilio UK sender set up so customers actually get texts
- [ ] Switch Stripe to live keys, make one real booking on your own card and refund it

## Phase 1: Launch essentials (weeks 2–3)

These close the gaps between the one-pager's promises and what the code does. Do them before taking strangers' money.

1. **Customer cancellation.** A cancel button on the status page and a link in the text. Applies the one-pager rules automatically: full refund before a barber confirms; service price back but £50 kept if 30+ min before; nothing back under 30 min. Uses Stripe partial refunds.
2. **Rules shown at payment.** Cancellation and lateness rules on step 4 with a tick box, and repeated in the confirmation text.
3. **Terms, refund policy and privacy notice pages.** You store names and phone numbers, so UK GDPR applies.
4. **No-barber timeout.** If nobody taps Assign within about 10 minutes, re-ping the Telegram group; after 20 minutes, auto-refund and text the customer.
5. **Reminder text** 30 minutes before the slot, with directions.
6. **Booking confirmation email** with a Stripe receipt, which also covers business customers who need an invoice.
7. **Error alerts.** Send failed webhooks or Stripe errors to the Telegram group so nothing fails silently.

## Phase 2: Running the nights (month 2)

Build these once real bookings show where the friction is. The README listed them as deliberately left out.

1. **Barber availability.** Each barber marks which nights they're on via Telegram (/on, /off) or the admin page. Slots only show on nights someone is free, so fewer refunds.
2. **Book ahead.** Let customers pick tomorrow or up to 7 days out, not just tonight. Needs a date picker and the slot logic run per day.
3. **Two chairs at once.** If two barbers are on, allow two bookings per slot, each tied to a barber.
4. **Correct slot length per service.** Block 45 / 60 / 75 min depending on the service, so a premium package doesn't overlap the next booking.
5. **Blackout dates.** Close nights from the admin page (holidays, shop events).
6. **Payouts report.** Per barber per week: cuts done, takings, late fees, Stripe fees. Export to CSV for splitting money with the lads.
7. **Customer late or no-show buttons** for the barber in Telegram, which apply the one-pager rules.

## Phase 3: Growth (months 3–4)

Aimed at the two target groups in the one-pager: busy professionals and high-end hotels.

1. **Hotel concierge links.** A unique booking link or QR code per hotel, so you can see which hotels send customers and pay them a referral fee.
2. **Concierge account.** Book on behalf of a guest, pay on the hotel's account, monthly invoice.
3. **Customer accounts by phone.** Log in with a text code; saved details for one-tap rebooking and booking history.
4. **Review request** text the morning after, pointing to Google reviews.
5. **Promo and referral codes** using Stripe coupons.
6. **Landing page and SEO.** A proper homepage for searches like "late night barber Altrincham", with photos, prices and the promise.
7. **Analytics.** Bookings by night, hour, service, hotel source and refund rate, on the admin page.

## Phase 4: The barber van (later)

Once the shop model is proven, the van brings back the mobile idea for areas beyond Zone 2.

1. **Location type per booking:** shop or van. Van bookings take a postcode and check it against zones.
2. **Zone pricing:** a call-out fee that rises with drive time from Hale.
3. **Travel-aware slots:** block drive time between van jobs.
4. **Live "barber on the way" text** with an ETA.
5. **Daytime service** from the van for offices and hotels, priced without the late fee.

## When to move to the next phase

Each phase starts when the one before has proved itself, not on a fixed date.

1. **Phase 0 → 1:** one real paid booking completed with a text sent and the alert claimed in Telegram.
2. **Phase 1 → 2:** cancellation works with partial refunds, and the policy pages are live. Then start taking bookings from the public.
3. **Phase 2 → 3:** about 10 bookings a week, or refunds caused by "nobody free" becoming common.
4. **Phase 3 → 4:** steady demand from areas outside Zone 2, enough to justify the cost of a van.

Open question: what does the FadeMasters owner want in return for out-of-hours use (a cut per booking, a flat fee)? That affects the payouts report in Phase 2.
