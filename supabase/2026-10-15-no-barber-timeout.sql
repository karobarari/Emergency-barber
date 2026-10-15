-- Run once in Supabase → SQL editor, before deploying the no-barber timeout.
alter table bookings add column if not exists paid_at timestamptz;     -- when Stripe confirmed payment; starts the no-barber clock
alter table bookings add column if not exists reminded_at timestamptz; -- when the group was re-pinged, so it only happens once
