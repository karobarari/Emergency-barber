-- Run once in Supabase → SQL editor, before deploying home visits (docs/SPEC-v2.md Phase 4). It's safe to re-run.

alter table bookings add column if not exists address text;            -- first line of the customer's address
alter table bookings add column if not exists postcode text;           -- normalised, e.g. "WA15 8SS"
alter table bookings add column if not exists lat double precision;
alter table bookings add column if not exists lng double precision;
alter table bookings add column if not exists drive_minutes int;       -- from the shop, used for pricing and blocks
alter table bookings add column if not exists drive_miles numeric;
alter table bookings add column if not exists distance_step int;       -- pence, travel charge
alter table bookings add column if not exists eta_at timestamptz;      -- when the barber should arrive
alter table bookings add column if not exists on_the_way_at timestamptz;
alter table bookings add column if not exists arrived_at timestamptz;
alter table bookings add column if not exists left_at timestamptz;     -- barber tapped "Left safely"
alter table bookings add column if not exists safety_alerted_at timestamptz; -- Karo was alerted that left_at is missing

-- Shop bookings have no travel.
update bookings set distance_step = 0 where distance_step is null and location_type = 'shop';

-- Drive times from the shop by postcode, so each postcode costs one routing call a month.
create table if not exists drive_cache (
  postcode   text primary key,
  lat        double precision not null,
  lng        double precision not null,
  minutes    int not null,
  miles      numeric not null,
  fetched_at timestamptz not null default now()
);
alter table drive_cache enable row level security;
