-- Run once in Supabase → SQL editor to set up a new database, then supabase/2026-10-19-capacity.sql,
-- supabase/2026-10-19-customers.sql and supabase/2026-10-19-preferred-barber.sql.
create extension if not exists pgcrypto;

create table if not exists bookings (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  name                text not null,
  phone               text not null,          -- E.164, e.g. +447700900123
  service_id          text not null,
  service_name        text not null,
  slot_at             timestamptz not null,
  location_type       text not null default 'shop' check (location_type in ('shop','home','hotel')),
  block_start         timestamptz not null,   -- when the barber is first busy (leaves the shop, for visits)
  block_end           timestamptz not null,   -- when they're free again
  service_price       int  not null,          -- pence
  advance_fee         int  not null,          -- pence, booking fee by how far ahead it was booked
  price_tier          text not null check (price_tier in ('12h','6h','standard')),
  total               int  not null,          -- pence
  status              text not null default 'pending'
                      check (status in ('pending','new','confirmed','on_the_way','arrived','done','no_show','refunded','expired','cancelled')),
  barber              text,
  preferred_barber    text,                   -- who the customer asked for, null = no preference
  allow_fallback      boolean not null default true, -- happy with another barber if the preferred one can't
  exclusive_until     timestamptz,            -- only the preferred barber can accept until then
  stripe_session_id   text,
  payment_intent      text,
  telegram_message_id bigint,
  refund_amount       int,                    -- pence, set when the customer cancels
  terms_accepted_at   timestamptz,            -- when they ticked the rules box at payment
  paid_at             timestamptz,            -- when the card hold was placed; starts the no-barber clock
  release_at          timestamptz,            -- when the cron releases the hold if no barber has taken it
  reminded_at         timestamptz,            -- when the group was re-pinged about an unclaimed booking
  slot_reminded_at    timestamptz,            -- when the customer got the 30-min reminder text
  done_nudged_at      timestamptz             -- when the barber was asked to tap Done
);

-- Bookings are inserted through reserve_booking(), which checks there's a barber and chair free.
-- Run supabase/2026-10-19-capacity.sql after this file to create it. Pending rows hold their place while the
-- customer is on Stripe; Stripe expires the checkout after 30 min and the webhook marks the row 'expired'.
create index if not exists bookings_slot_at on bookings (slot_at);

-- Only the server (service role key) touches this table.
alter table bookings enable row level security;
