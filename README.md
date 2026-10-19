# Emergency Barber App

A booking web app for urgent, out-of-hours haircuts. Customers get a premium cut at short notice; barbers earn extra on their own schedule.

**The promise:** on the chair within an hour, with bookings taken up to midnight.

## The problem

Busy professionals and guests at high-end hotels sometimes need a cut urgently, before a meeting, event or flight. In the evening, shops are closed, booking apps only show daytime slots, and walk-ins mean waiting.

## How it works

### Customer flow

1. Choose a service and a time (tonight or up to 6 days ahead) and see the total, including the booking fee.
2. Enter card details. Nothing is charged yet.
3. A barber accepts the booking, and the customer gets a confirmation with the time.
4. The card is charged.
5. The customer drives to the shop for their cut.

### Barber flow

1. The admin (Karo) is notified of every new booking.
2. The admin assigns it to himself or one of the two other barbers.
3. The assigned barber opens the shop and does the cut.

**Location:** FadeMasters Hale, 313 Hale Rd, Hale Barns, Altrincham WA15 8SS

## Services and pricing

Every booking includes a booking fee, because the barber opens the shop out of hours. The earlier the customer books, the lower it is: £25 for 12+ hours ahead, £35 for 6–12 hours, £50 for under 6 hours. The fee is worked out when they pay and locked into the card hold (`lib/pricing.ts`).

| Service         | Price | 12h+ ahead | 6–12h ahead | Under 6h |
| --------------- | ----- | ---------- | ----------- | -------- |
| Skin fade       | £26   | £51        | £61         | £76      |
| Hair and beard  | £39   | £64        | £74         | £89      |
| Premium package | £65   | £90        | £100        | £115     |

## Payment model

- The card is saved at booking, but **not charged** until a barber accepts.
- If no barber accepts, the booking is cancelled and nothing is charged.
- Saving the card upfront protects barbers from no-shows when they open the shop out of hours.

## Features (first version)

- [ ] Service selection and price display
- [ ] Card saving at booking
- [ ] New-booking notifications to the admin
- [ ] Barber assignment
- [ ] Charge on acceptance
- [ ] Customer confirmation

## Roadmap

- More barbers and locations
- A mobile barber van
