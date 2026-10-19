-- Run once in Supabase → SQL editor, before deploying booking ahead (docs/SPEC-v2.md Phase 1).
-- The flat £50 late fee becomes a booking fee that depends on how far ahead the customer books.
alter table bookings add column if not exists advance_fee int;          -- pence, locked in at checkout
alter table bookings add column if not exists price_tier text
  check (price_tier in ('12h','6h','standard'));                         -- how far ahead it was booked
alter table bookings add column if not exists release_at timestamptz;   -- when the cron releases an unclaimed hold

-- Existing bookings all paid the £50 fee on the short dispatch clock.
update bookings set advance_fee = late_fee where advance_fee is null;
update bookings set price_tier = 'standard' where price_tier is null;
update bookings set release_at = paid_at + interval '20 minutes' where release_at is null and paid_at is not null;

-- The app stops writing late_fee. Kept for old rows; safe to drop once nothing reads it.
alter table bookings alter column late_fee drop not null;
