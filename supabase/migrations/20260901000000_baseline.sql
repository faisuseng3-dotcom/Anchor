-- Baslinje: tabellerna som skapades i Supabases webbgränssnitt, som de såg ut innan migreringarna 2026-11-11.
-- Kolumner, begränsningar och index lästa ur produktionen 2026-11-12; policyerna och den första reports_guard ur
-- produktionen 2026-11-11, innan de ändrades. Körs bara mot en tom databas: i produktionen finns allt redan, och där
-- stoppar första create table körningen. Senare migreringar lägger till reports.reporter, stänger de tre gamla
-- tabellerna och byter ut reports_guard.
begin;

create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  venue_id      text not null,
  venue_name    text not null,
  queue_status  text not null check (queue_status in ('none', 'short', 'medium', 'long')),
  user_id       text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  people_ahead  smallint check (people_ahead >= 0 and people_ahead <= 200),
  report_type   text not null default 'initial' check (report_type in ('initial', 'followup', 'entered')),
  queue_session text,
  near_venue    boolean,
  comment       text check (comment is null or char_length(comment) <= 80)
);
create index idx_reports_created_at on public.reports (created_at);
create index idx_reports_expires_at on public.reports (expires_at);
create index idx_reports_venue_id on public.reports (venue_id);
create index reports_venue_created_idx on public.reports (venue_id, created_at desc);

create table public.favorites (
  id         uuid primary key default gen_random_uuid(),
  venue_id   text not null,
  user_id    text not null,
  created_at timestamptz default now(),
  unique (venue_id, user_id)
);

create table public.user_profiles (
  user_id       text primary key,
  points        integer default 0,
  reports_count integer default 0,
  badges        jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  last_active   timestamptz default now()
);

create table public.report_votes (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid references public.reports (id) on delete cascade,
  user_id    text not null,
  created_at timestamptz default now(),
  unique (report_id, user_id)
);

alter table public.reports enable row level security;
alter table public.favorites enable row level security;
alter table public.user_profiles enable row level security;
alter table public.report_votes enable row level security;

create policy "Anyone can read reports" on public.reports for select using (true);
create policy "Anyone can create reports" on public.reports for insert with check (true);
-- De här fyra lät vem som helst läsa, ändra och radera allas rader; 20261111010000_lock_legacy_tables tar bort dem.
create policy "Anyone can manage favorites" on public.favorites for all using (true);
create policy "Anyone can read favorites" on public.favorites for select using (true);
create policy "Anyone can manage profiles" on public.user_profiles for all using (true);
create policy "Anyone can read profiles" on public.user_profiles for select using (true);
create policy "Anyone can vote" on public.report_votes for all using (true);

create function public.reports_guard() returns trigger language plpgsql as $$
declare
  last_initial timestamptz;
  s_started timestamptz; s_last timestamptz; s_count int; s_done boolean; s_venue text;
begin
  new.created_at := now();
  if new.report_type = 'initial' then
    select max(created_at) into last_initial from public.reports
     where user_id = new.user_id and report_type = 'initial';
    if last_initial > now() - interval '20 minutes' then raise exception 'rate_limited'; end if;
    return new;
  end if;
  if new.queue_session is null then raise exception 'session_required'; end if;
  select min(created_at), max(created_at), count(*), bool_or(report_type = 'entered'), min(venue_id)
    into s_started, s_last, s_count, s_done, s_venue
    from public.reports where queue_session = new.queue_session and user_id = new.user_id;
  if s_started is null or s_started < now() - interval '90 minutes' then raise exception 'session_expired'; end if;
  if s_venue <> new.venue_id then raise exception 'session_venue_mismatch'; end if;
  if s_done then raise exception 'session_closed'; end if;
  if s_count >= 6 then raise exception 'session_limit'; end if;
  if new.report_type = 'followup' and s_last > now() - interval '3 minutes' then raise exception 'too_soon'; end if;
  return new;
end $$;
create trigger reports_guard before insert on public.reports for each row execute function public.reports_guard();

-- Realtid: appen lyssnar på nya rapporter.
alter publication supabase_realtime add table public.reports;

commit;
