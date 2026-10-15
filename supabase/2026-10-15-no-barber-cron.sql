-- Run once in Supabase → SQL editor, after /api/cron/no-barber is deployed.
-- Calls the app every 2 minutes to chase and refund unclaimed bookings.
-- First store the same value as CRON_SECRET on Vercel:
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'no-barber-check',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := 'https://emergency-barber.vercel.app/api/cron/no-barber',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
