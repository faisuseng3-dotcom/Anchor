-- Kömätningarna sparas för gott, utan id. Gallringen (20261111060000_retention.sql) raderade rapporter äldre än 90 dagar,
-- och med dem ställenas historik: väntetid, antal i kö och tid som krogarna ska kunna se över längre tid än så. Nu flyttas
-- varje rapport till reports_archive innan den raderas, utan user_id och reporter och med nytt id och saltad queue_session
-- (de publika rapporterna har haft id och queue_session i klartext), så att kopian inte går att koppla
-- till en telefon (integritetspolicyn: "Efter 90 dagar raderas de"; det som blir kvar är anonymt). "Radera min data"
-- inom 90 dagar tar bort rapporten innan den hunnit arkiveras. Demostället qbar-demo arkiveras inte.
create table if not exists public.reports_archive (
  id            uuid primary key default gen_random_uuid(), -- nytt id, inte rapportens
  venue_id      text not null,
  venue_name    text not null,
  queue_status  text not null,
  people_ahead  smallint,
  report_type   text not null,
  queue_session text,                          -- md5(archive_salt || queue_session): binder ihop en kö, inte en person
  near_venue    boolean,
  created_at    timestamptz not null
);
-- Om tabellen redan skapats med den första versionen av filen (id utan default).
alter table public.reports_archive alter column id set default gen_random_uuid();
create index if not exists idx_reports_archive_venue_created on public.reports_archive (venue_id, created_at);
-- Ingen i appen eller på krogsidan läser arkivet: bara service role (SQL-editorn, rapporter till ställena).
alter table public.reports_archive enable row level security;
revoke all on public.reports_archive from anon, authenticated;

-- Saltet finns bara i databasen (app_secrets, 20261111070000_ip_limit.sql), så arkivets sessioner går inte att räkna om
-- till de publika.
insert into public.app_secrets (key, value) values ('archive_salt', gen_random_uuid()::text) on conflict (key) do nothing;

-- Samma jobbnamn: pg_cron skriver över det gamla jobbet. Kopian och raderingen är en transaktion, så en ny körning
-- dubblerar inget fast id:t är nytt.
select cron.schedule('qbar-gallring', '30 3 * * *', $$
  insert into public.reports_archive (venue_id, venue_name, queue_status, people_ahead, report_type, queue_session, near_venue, created_at)
  select venue_id, venue_name, queue_status, people_ahead, report_type,
         md5((select value from public.app_secrets where key = 'archive_salt') || queue_session), near_venue, created_at
    from public.reports where created_at < now() - interval '90 days' and venue_id <> 'qbar-demo';
  delete from public.reports where created_at < now() - interval '90 days';
  delete from public.on_my_way where expires_at < now();
$$);
