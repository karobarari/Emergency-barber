# Emergency Barber · FadeMasters Hale

Out-of-hours priority cuts. A customer books at least an hour ahead (latest slot midnight) and pays in full upfront. The barbers' Telegram group gets an alert, someone taps their name, and the customer gets a text saying who is opening the shop and when.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres) · Stripe Checkout · Telegram bot · Twilio SMS. Deploy on Vercel.

## How a booking flows

1. Customer picks a service, a free slot and enters name + UK mobile.
2. `/api/checkout` re-checks the slot, inserts a `pending` booking (a unique index stops double booking) and opens Stripe Checkout. The checkout expires after 30 minutes, which frees the slot.
3. Stripe calls `/api/stripe/webhook` → booking becomes `new` → Telegram alert with a button per barber, plus a refund button. The customer gets a "payment received" text.
4. A barber taps their name → booking becomes `confirmed` (only the first tap wins), the alert updates for the whole group, and the customer is texted with the barber's name, time and directions.
5. Nobody free → tap refund → Stripe refund and an apology text.
6. `/admin` (password protected) shows tonight's jobs with the same assign, refund and done actions.

## Prices and rules

Edit `lib/config.ts`:

| Service | Price | + Late fee | Total |
|---|---|---|---|
| Skin fade / haircut | £26 | £50 | £76 |
| Haircut + beard | £39 | £50 | £89 |
| Premium package | £65 | £50 | £115 |

Slot window comes from env: `OPEN_FROM` (first out-of-hours slot, **set this to the shop's closing time**; it defaults to 19:00 as a placeholder) and `LAST_SLOT=00:00`. 15-minute steps, 60 minutes' notice, one customer per slot, all in London time.

## Setup (about 30 minutes)

1. **Code:** `npm install`, copy `.env.example` to `.env.local`.
2. **Supabase:** create a project, run `supabase/schema.sql` in the SQL editor, then copy the URL and service role key.
3. **Stripe:** copy the secret key. Locally, run `stripe listen --forward-to localhost:3000/api/stripe/webhook` for the signing secret. In production, add a webhook for `checkout.session.completed` and `checkout.session.expired` pointing at `https://YOUR-DOMAIN/api/stripe/webhook`.
4. **Telegram:**
   - Create a bot with @BotFather and copy the token.
   - Make a group with you and the two barbers, add the bot, send a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to find the group's chat id (it starts with `-100`).
   - Pick a random `TELEGRAM_WEBHOOK_SECRET`, then register the webhook once deployed:
     ```
     curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-DOMAIN/api/telegram&secret_token=<SECRET>&allowed_updates=[\"callback_query\"]"
     ```
5. **Twilio (optional to start):** without it, texts are logged to the console instead of sent. A UK number or an alphanumeric sender ID works for one-way texts.
6. **Admin:** set `ADMIN_PASSWORD` and `BARBER_NAMES`.
7. `npm run dev`, book with Stripe test card `4242 4242 4242 4242`, and watch the Telegram alert arrive.
8. **Deploy:** push to GitHub, import into Vercel, add the same env vars, and set `SITE_URL` to the live domain.

## Before going live

- Agree the out-of-hours arrangement with the FadeMasters owner: keys, alarm, and that the shop's insurance covers barbers working while it's closed.
- Switch Stripe to live keys and re-create the production webhook.
- Add a short cancellation/refund policy and privacy notice (you store names and phone numbers).

## Not built yet (on purpose)

Booking more than one evening ahead, customer cancellations, several customers per slot, and per-barber availability. Add them once real bookings show they're needed.
