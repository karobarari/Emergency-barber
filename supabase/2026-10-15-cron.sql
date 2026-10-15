-- Run once in Supabase → SQL editor, after /api/cron is deployed.
-- Calls the app every 2 minutes to chase unclaimed bookings and send reminder texts.
-- First store the same value as CRON_SECRET on Vercel:
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replaces the first version of this job, which only did the no-barber check.
select cron.unschedule('no-barber-check') where exists (select 1 from cron.job where jobname = 'no-barber-check');

select cron.schedule(
  'booking-checks',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := 'https://emergency-barber.vercel.app/api/cron',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
