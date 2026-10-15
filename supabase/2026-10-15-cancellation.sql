-- Run once in Supabase → SQL editor, before deploying customer cancellation.
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('pending','new','confirmed','done','refunded','expired','cancelled'));

alter table bookings add column if not exists refund_amount int; -- pence
