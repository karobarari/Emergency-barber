-- Run once in Supabase → SQL editor, before deploying the capacity model (docs/SPEC-v2.md Phase 2).
-- Then run it again straight after deploying, to fill in blocks for any bookings made in between. It's safe to re-run.
--
-- Replaces "one booking per 15-minute slot" with a check on how long each booking keeps a barber (and the chair) busy.

alter table bookings add column if not exists location_type text not null default 'shop'
  check (location_type in ('shop','home','hotel'));
alter table bookings add column if not exists block_start timestamptz; -- when the barber is first busy (leaves the shop, for visits)
alter table bookings add column if not exists block_end timestamptz;   -- when they're free again

-- Existing bookings are all at the shop: blocked for the length of the service.
update bookings
   set block_start = slot_at,
       block_end = slot_at + make_interval(mins => case service_id when 'cut' then 40 when 'cutbeard' then 55 else 75 end)
 where block_start is null;

drop index if exists bookings_one_per_slot;
create index if not exists bookings_block on bookings (block_start, block_end);

/*
 * Checks there's room for a booking and inserts it, in one go. The advisory lock makes checkouts take turns,
 * so two customers can't both take the last place. Raises EBFUL if it doesn't fit.
 * Same rule as hasRoom() in lib/capacity.ts:
 *   shop:         overlapping shop bookings < shop chairs, and overlapping bookings < barbers
 *   home / hotel: overlapping bookings <= barbers - 2, so one barber is always left for the shop
 * p_booking is the row as JSON, with block_start and block_end set. id and created_at are filled in here;
 * every other column without a value is null, so pass anything that's "not null" (status, location_type, ...).
 */
create or replace function reserve_booking(p_booking jsonb, p_barber_count int, p_shop_chairs int)
returns bookings
language plpgsql
as $$
declare
  v_type text := p_booking->>'location_type';
  v_start timestamptz := (p_booking->>'block_start')::timestamptz;
  v_end timestamptz := (p_booking->>'block_end')::timestamptz;
  v_any int;
  v_shop int;
  v_row bookings;
begin
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'reserve_booking needs block_start before block_end' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7231001); -- any fixed number; released when the transaction ends

  select count(*), count(*) filter (where location_type = 'shop')
    into v_any, v_shop
    from bookings
   where status in ('pending','new','confirmed','on_the_way','arrived')
     and block_start < v_end
     and block_end > v_start;

  if (v_type = 'shop' and (v_shop >= p_shop_chairs or v_any >= p_barber_count))
     or (v_type <> 'shop' and v_any > p_barber_count - 2) then
    raise exception 'No room for this booking' using errcode = 'EBFUL';
  end if;

  insert into bookings
  select * from jsonb_populate_record(null::bookings, p_booking || jsonb_build_object('id', gen_random_uuid(), 'created_at', now()))
  returning * into v_row;
  return v_row;
end;
$$;
