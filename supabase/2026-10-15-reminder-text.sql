-- Run once in Supabase → SQL editor, before deploying the reminder text.
alter table bookings add column if not exists slot_reminded_at timestamptz; -- when the 30-min reminder text went out
