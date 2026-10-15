-- Run once in Supabase → SQL editor, before deploying the rules tick box.
alter table bookings add column if not exists terms_accepted_at timestamptz;
