-- Kömätningarna sparas för gott, utan id. Gallringen (20261111060000_retention.sql) raderade rapporter äldre än 90 dagar,
-- och med dem ställenas historik: väntetid, antal i kö och tid som krogarna ska kunna se över längre tid än så. Nu flyttas
-- varje rapport till reports_archive innan den raderas, utan user_id och reporter, så att kopian inte går att koppla
-- till en telefon (integritetspolicyn: "Efter 90 dagar raderas de"; det som blir kvar är anonymt). "Radera min data"
-- inom 90 dagar tar bort rapporten innan den hunnit arkiveras. Demostället qbar-demo arkiveras inte.
create table if not exists public.reports_archive (
  id            uuid primary key,              -- samma id som i reports: en körning till av jobbet dubblerar inget
  venue_id      text not null,
  venue_name    text not null,
  queue_status  text not null,
  people_ahead  smallint,
  report_type   text not null,
  queue_session text,                          -- slumpat per kö, inte per telefon: binder ihop en kö, inte en person
  near_venue    boolean,
  created_at    timestamptz not null
);
create index if not exists idx_reports_archive_venue_created on public.reports_archive (venue_id, created_at);
-- Ingen i appen eller på krogsidan läser arkivet: bara service role (SQL-editorn, rapporter till ställena).
alter table public.reports_archive enable row level security;
revoke all on public.reports_archive from anon, authenticated;

-- Samma jobbnamn: pg_cron skriver över det gamla jobbet.
select cron.schedule('qbar-gallring', '30 3 * * *', $$
  insert into public.reports_archive (id, venue_id, venue_name, queue_status, people_ahead, report_type, queue_session, near_venue, created_at)
  select id, venue_id, venue_name, queue_status, people_ahead, report_type, queue_session, near_venue, created_at
    from public.reports where created_at < now() - interval '90 days' and venue_id <> 'qbar-demo'
  on conflict (id) do nothing;
  delete from public.reports where created_at < now() - interval '90 days';
  delete from public.on_my_way where expires_at < now();
$$);
