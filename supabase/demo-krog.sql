-- Demo för Qbar för krogar: ett påhittat ställe, 'qbar-demo', med 8 veckors kvällar fram till nu. Inte en migrering:
-- kör om före varje demo (rutnätet och "i kväll" räknas från now()). Rör bara qbar-demo och demokontot.
--   npx -y supabase@latest db query --remote=awwmfsjsrjktekmbgadx --yes -f supabase/demo-krog.sql
-- qbar-demo finns inte i VENUES, så appen visar det aldrig (loadReports släpper bara igenom kända venue_id).
-- Inga kö-sessioner: appens loadHistoricalRates läser de 1000 senaste sessionsraderna för alla ställen, och demorader
-- skulle tränga undan riktiga. Inga rader framåt i tiden: loadReports läser alla icke-utgångna rapporter (tak 1000).
-- Varje rad går ut som en realtidshändelse till öppna appar (en samlad omläsning per klient); kör inte mitt i en kväll.
begin;

-- reports_guard skriver över created_at och spärrar per user_id; notify_favorites anropar notify-favorites per rad.
-- Avstängda bara i den här transaktionen.
alter table public.reports disable trigger user;

delete from public.reports where venue_id = 'qbar-demo';

with nights as (
  select d, ((now() - interval '6 hours') at time zone 'Europe/Stockholm')::date - d night from generate_series(0, 56) d
), slots as (
  -- Var 10:e minut 21:00–02:50. Nivå (index i AHEAD_BUCKETS) = veckodagens bas + kvällens form, lördag längst.
  select n.d, k, (n.night + time '21:00' + k * interval '10 minutes') at time zone 'Europe/Stockholm' t,
         greatest(0, least(4, (array[0, 0, 0, 1, 1, 2, 3])[extract(dow from n.night)::int + 1]
                            + (array[-1, 0, 1, 1, 0, -1])[k / 6 + 1])) lvl
    from nights n, generate_series(0, 35) k
), rows as (
  select t, lvl, (k + d) % 4 p from slots where t <= now()
  union all -- "Kön just nu" även när demon visas dagtid
  select now() - m * interval '1 minute', 3, i from unnest(array[25, 18, 11, 4]) with ordinality x(m, i)
)
insert into public.reports (venue_id, venue_name, queue_status, user_id, reporter, people_ahead, report_type, near_venue,
                            created_at, expires_at)
select 'qbar-demo', 'Qbar demo', (array['none', 'short', 'medium', 'long', 'long'])[lvl + 1], 'demo-krog-seed-' || p,
       'demo-krog-' || p, (array[0, 5, 17, 37, 60])[lvl + 1], 'initial', true, t, t + interval '45 minutes'
  from rows;

alter table public.reports enable trigger user;

delete from public.on_my_way where venue_id = 'qbar-demo';
insert into public.on_my_way (user_id, venue_id, expires_at)
select 'demo-krog-omw-' || i, 'qbar-demo', now() + interval '2 hours' from generate_series(1, 6) i;

-- Inloggningen (auth-användaren demo@queuebar.se) skapas en gång enligt supabase/README.md.
insert into public.venue_accounts (email, venue_id, pace) values ('demo@queuebar.se', 'qbar-demo', 'normal')
on conflict (email) do update set venue_id = excluded.venue_id, pace = excluded.pace;

commit;
