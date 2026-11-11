-- Gallring. Rapporterna sparades utan tidsgräns, fast appen bara läser 8 veckor bakåt (dörrtakten samma veckodag och
-- tid). Nu raderas rapporter äldre än 90 dagar varje natt, och utgångna "på väg"-rader med dem.
-- delete_expired_reports() var död kod: körde som anon, som inte får radera, och anropades aldrig.
create extension if not exists pg_cron;

select cron.schedule('qbar-gallring', '30 3 * * *', $$
  delete from public.reports where created_at < now() - interval '90 days';
  delete from public.on_my_way where expires_at < now();
$$);

drop function if exists public.delete_expired_reports();
