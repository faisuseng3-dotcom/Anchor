-- Inför App Store (granskningen 2026-11-24, A-1 och A-5). Kan köras före den nya klienten: den gamla klientens historik
-- blir bara tom (läsningarna nekas inte, de ger aktiva rader), och den gamla klienten skickar alltid antal.
--  1. Anon läser bara aktiva rapporter (45 min). Förut gick alla rapporter i 90 dagar att läsa med reporter, så den som
--     kände till en enda rapport kunde följa samma telefon bakåt. Historiken som appen behöver (dörrtakt och "Brukar
--     vara") kommer nu från report_history(), utan reporter och net; den egna historiken från my_reports(user_id).
--  2. En kömätning (initial) måste ha antal, och queue_status måste stämma med det: förut räckte en enda rad med
--     people_ahead = null och queue_status 'long' för att kartan skulle visa "30+ min", förbi "minst 3 överens".
begin;

-- ── 1. Läsning ──────────────────────────────────────────────────────────────
drop policy if exists "Anyone can read reports" on public.reports;
create policy "Aktiva rapporter" on public.reports for select using (expires_at > now());

-- 8 veckor bakåt: det loadHistoricalRates och loadHistoricalPatterns i src/main.js läser. PostgREST filtrerar och
-- begränsar svaret som en tabell. Demostället hoppas över (DEMO_VENUE_ID).
create or replace function public.report_history()
returns table (venue_id text, queue_status text, people_ahead smallint, report_type text, queue_session text,
               created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select venue_id, queue_status, people_ahead, report_type, queue_session, created_at
    from reports where created_at > now() - interval '8 weeks' and venue_id <> 'qbar-demo';
$$;
revoke all on function public.report_history() from public;
grant execute on function public.report_history() to anon;

-- Profilens historik. user_id är hemligt (samma nyckel som delete_my_data), reporter är det inte längre.
create or replace function public.my_reports(p_user_id text)
returns table (id uuid, venue_id text, venue_name text, people_ahead smallint, queue_session text, report_type text,
               created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, venue_id, venue_name, people_ahead, queue_session, report_type, created_at
    from reports where user_id = p_user_id and length(p_user_id) >= 20 order by created_at desc;
$$;
revoke all on function public.my_reports(text) from public;
grant execute on function public.my_reports(text) to anon;

-- ── 2. Antal krävs ──────────────────────────────────────────────────────────
-- Samma funktion som i 20261122000000_report_hardening.sql, plus ahead_required och status_mismatch.
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_initial timestamptz;
  s_started timestamptz; s_last timestamptz; s_count int; s_done boolean; s_venue text;
  h text;
begin
  new.created_at := now();
  new.expires_at := now() + interval '45 minutes';
  new.reporter := encode(sha256(convert_to(new.user_id, 'UTF8')), 'hex');
  new.net := null; -- sätts bara här, aldrig av klienten
  select name into new.venue_name from venues where id = new.venue_id;
  if not found then raise exception 'unknown_venue'; end if;
  if new.report_type = 'initial' then
    if new.people_ahead is null then raise exception 'ahead_required'; end if;
    -- Minuterna beror på kvällens takt och räknas i appen; men "Ingen kö" är alltid 0 framför och tvärtom.
    if (new.people_ahead = 0) <> (new.queue_status = 'none') then raise exception 'status_mismatch'; end if;
    select max(created_at) into last_initial from public.reports
     where user_id = new.user_id and report_type = 'initial';
    if last_initial > now() - interval '5 minutes' then raise exception 'rate_limited'; end if;
    if new.queue_session is not null and exists (select 1 from reports where queue_session = new.queue_session) then
      raise exception 'session_taken';
    end if;
    h := qbar_ip_limit('report', 50);
    if h is not null then
      -- Kvällen börjar 06:00 svensk tid, som i appen: samma nät får samma hash hela natten.
      new.net := left(md5(h || ((now() at time zone 'Europe/Stockholm') - interval '6 hours')::date), 10);
      if (select count(*) from reports where venue_id = new.venue_id and net = new.net and report_type = 'initial'
            and created_at > now() - interval '45 minutes') >= 2 then
        raise exception 'venue_ip_limited';
      end if;
    end if;
    return new;
  end if;
  if new.queue_session is null then raise exception 'session_required'; end if;
  select min(created_at), max(created_at), count(*), bool_or(report_type in ('entered', 'refused', 'left')), min(venue_id)
    into s_started, s_last, s_count, s_done, s_venue
    from public.reports where queue_session = new.queue_session and user_id = new.user_id;
  if s_started is null or s_started < now() - interval '90 minutes' then raise exception 'session_expired'; end if;
  if s_venue <> new.venue_id then raise exception 'session_venue_mismatch'; end if;
  if s_done then raise exception 'session_closed'; end if;
  if s_count >= 6 then raise exception 'session_limit'; end if;
  if new.report_type = 'followup' and s_last > now() - interval '3 minutes' then raise exception 'too_soon'; end if;
  return new;
end $$;

commit;
