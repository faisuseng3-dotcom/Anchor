-- Demostället qbar-demo hålls levande: var 10:e minut en kömätning (fyra påhittade personer i tur och ordning, så att
-- minst tre är överens) och sex "på väg". Då har krogsidans demo alltid "kön just nu", en kurva i kväll och ett rutnät,
-- utan att supabase/demo-krog.sql körs om. Raden går genom reports_guard som en vanlig rapport (created_at = now()).
-- Kvällsformen är samma som i demo-krog.sql; utanför 21–03 en kort kö.
-- Appens historikläsningar hoppar över qbar-demo (src/main.js), annars tränger demoraderna undan riktiga ställen ur taket
-- på 1000 rader.
create or replace function public.qbar_demo_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  local timestamp := now() at time zone 'Europe/Stockholm';
  night date := (local - interval '6 hours')::date;
  k int := floor(extract(epoch from local - (night + time '21:00')) / 600)::int; -- 10-minutersplats sedan 21:00
  lvl int := 1;
  p int := (extract(epoch from now())::bigint / 600 % 4)::int;
begin
  if not exists (select 1 from venue_accounts where venue_id = 'qbar-demo') then return; end if;
  if k between 0 and 35 then
    lvl := greatest(0, least(4, (array[0, 0, 0, 1, 1, 2, 3])[extract(dow from night)::int + 1]
                                + (array[-1, 0, 1, 1, 0, -1])[k / 6 + 1]));
  end if;
  insert into reports (venue_id, venue_name, queue_status, user_id, people_ahead, report_type, near_venue, expires_at)
  values ('qbar-demo', 'Qbar demo', (array['none', 'short', 'medium', 'long', 'long'])[lvl + 1], 'demo-krog-seed-' || p,
          (array[0, 5, 17, 37, 60])[lvl + 1], 'initial', true, now());
  insert into on_my_way (user_id, venue_id, expires_at)
  select 'demo-krog-omw-' || i, 'qbar-demo', now() + interval '30 minutes' from generate_series(1, 6) i
  on conflict (user_id) do update set expires_at = excluded.expires_at;
end $$;
revoke all on function public.qbar_demo_tick() from public, anon, authenticated;

select cron.schedule('qbar-demo', '*/10 * * * *', 'select public.qbar_demo_tick()');
