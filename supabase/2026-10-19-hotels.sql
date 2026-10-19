-- Run once in Supabase → SQL editor, before deploying hotel bookings (docs/SPEC-v2.md Phase 6). It's safe to re-run.

-- Partner hotels. Each gets a booking link /h/[slug] for its concierge.
create table if not exists hotels (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text unique not null,      -- /h/[slug]
  name                   text not null,
  address                text not null,
  postcode               text not null,
  lat                    double precision,
  lng                    double precision,
  drive_minutes          int,                       -- from the shop
  drive_miles            numeric,
  arrival_notes          text,                      -- e.g. "report to front desk"
  contact_name           text,
  contact_phone          text,
  contact_email          text,
  distance_step_override int,                       -- pence; replaces the drive-time travel charge if set
  active                 boolean not null default true,
  created_at             timestamptz default now()
);
alter table hotels enable row level security;

alter table bookings add column if not exists hotel_id uuid references hotels(id);
alter table bookings add column if not exists guest_name text;   -- who's having the cut
alter table bookings add column if not exists room text;
alter table bookings add column if not exists booker_name text;  -- the concierge, who gets the texts
alter table bookings add column if not exists booker_phone text;
