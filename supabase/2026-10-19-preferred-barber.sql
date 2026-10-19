-- Run once in Supabase → SQL editor, before deploying the preferred barber step (docs/SPEC-v2.md Phase 3b). It's safe to re-run.
alter table bookings add column if not exists preferred_barber text;                       -- null = no preference
alter table bookings add column if not exists allow_fallback boolean not null default true; -- happy with another barber
alter table bookings add column if not exists exclusive_until timestamptz;                  -- only the preferred barber can accept until then
