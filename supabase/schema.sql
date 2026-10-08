-- Run once in Supabase → SQL editor
create extension if not exists pgcrypto;

create table if not exists bookings (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  name                text not null,
  phone               text not null,          -- E.164, e.g. +447700900123
  service_id          text not null,
  service_name        text not null,
  slot_at             timestamptz not null,
  service_price       int  not null,          -- pence
  late_fee            int  not null,          -- pence
  total               int  not null,          -- pence
  status              text not null default 'pending'
                      check (status in ('pending','new','confirmed','done','refunded','expired')),
  barber              text,
  stripe_session_id   text,
  payment_intent      text,
  telegram_message_id bigint
);

-- One customer per slot. Pending rows hold the slot while the customer is on Stripe;
-- Stripe expires the checkout after 30 min and the webhook marks the row 'expired'.
create unique index if not exists bookings_one_per_slot
  on bookings (slot_at) where status in ('pending','new','confirmed');

create index if not exists bookings_slot_at on bookings (slot_at);

-- Only the server (service role key) touches this table.
alter table bookings enable row level security;
