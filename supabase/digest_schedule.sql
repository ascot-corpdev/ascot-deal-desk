-- Weekly digest schedule (Supabase Cron). Run in the Supabase SQL editor AFTER deploying the digest function
-- and setting its secrets (see README, "Weekly email digest"). Replace the two placeholders first.
-- Needs the pg_cron and pg_net extensions (Database > Extensions, or the two lines below).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The function address and the shared secret live in Supabase Vault, not in the job text.
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co/functions/v1/digest', 'digest_url');
select vault.create_secret('THE_SAME_VALUE_AS_DIGEST_SECRET', 'digest_secret');

-- Mondays at 07:17 UTC (07:17 in London in winter, 08:17 in summer). Change the five fields to move it.
select cron.schedule('deal-desk-weekly-digest', '17 7 * * 1', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'digest_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-digest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_secret')),
    body    := '{}'::jsonb
  );
$$);

-- Check it ran:      select * from cron.job_run_details order by start_time desc limit 5;
-- Stop the digest:   select cron.unschedule('deal-desk-weekly-digest');
