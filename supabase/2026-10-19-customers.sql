-- Run once in Supabase → SQL editor, before deploying the customers table (docs/SPEC-v2.md Phase 3a). It's safe to re-run.
--
-- Remembers customers by phone number once a shop cut is done. A finished shop visit unlocks home visits later (§6).

create table if not exists customers (
  phone                 text primary key,           -- E.164, e.g. +447700900123
  name                  text,
  completed_shop_visits int not null default 0,
  last_barber           text,                       -- barber on their last done booking
  home_allowed          boolean not null default false,
  blocked               boolean not null default false, -- overrides home_allowed
  notes                 text,                       -- private, admin only
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
alter table customers enable row level security;

-- New statuses: on_the_way and arrived for home and hotel visits (later phases), no_show for all.
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('pending','new','confirmed','on_the_way','arrived','done','no_show','refunded','expired','cancelled'));

alter table bookings add column if not exists done_nudged_at timestamptz; -- when the barber was asked to tap Done

-- Customers whose shop cuts were already marked done before this table existed.
insert into customers (phone, name, completed_shop_visits, last_barber, home_allowed)
select distinct on (phone)
       phone, name, count(*) over (partition by phone), barber, true
  from bookings
 where status = 'done' and location_type = 'shop'
 order by phone, slot_at desc
on conflict (phone) do nothing;

/*
 * Counts a finished shop cut: creates the customer if they're new, adds one visit, and unlocks home visits.
 * One statement, so two Done taps landing together still count once each (the booking transition stops a double count).
 */
create or replace function record_shop_visit(p_phone text, p_name text, p_barber text)
returns customers
language sql
as $$
  insert into customers (phone, name, completed_shop_visits, last_barber, home_allowed)
  values (p_phone, p_name, 1, p_barber, true)
  on conflict (phone) do update
     set name = excluded.name,
         completed_shop_visits = customers.completed_shop_visits + 1,
         last_barber = excluded.last_barber,
         home_allowed = true,
         updated_at = now()
  returning *;
$$;
