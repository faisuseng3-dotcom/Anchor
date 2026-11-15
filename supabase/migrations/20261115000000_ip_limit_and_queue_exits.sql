-- 1. Spärren per nät 10 → 50 kömätningar i timmen. Alla på en klubbs wifi delar en IP-adress: med 10 fick den elfte
--    gästen "Många rapporter från samma nät" just en kväll när rapporterna behövs mest. 50 stoppar fortfarande ett
--    skript som byter user_id (spärren per id är 5 min).
-- 2. Två nya sätt att lämna kön: 'refused' (nekad i dörren, people_ahead 0: kön nåddes, så dörrens takt mäts som vid
--    'entered') och 'left' (gav upp, people_ahead null: ingen mätpunkt). Båda avslutar sessionen som 'entered'.
--    Förut avslutade krysset kön utan att skicka något, och appen lärde sig bara av dem som kom in.
-- Samma funktion som i 20261113000000_report_cooldown.sql i övrigt.
alter table public.reports drop constraint reports_report_type_check;
alter table public.reports add constraint reports_report_type_check
  check (report_type in ('initial', 'followup', 'entered', 'refused', 'left'));

create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_initial timestamptz;
  s_started timestamptz; s_last timestamptz; s_count int; s_done boolean; s_venue text;
  ip text; h text;
begin
  new.created_at := now();
  new.expires_at := now() + interval '45 minutes';
  new.reporter := encode(sha256(convert_to(new.user_id, 'UTF8')), 'hex');
  if new.report_type = 'initial' then
    select max(created_at) into last_initial from public.reports
     where user_id = new.user_id and report_type = 'initial';
    if last_initial > now() - interval '5 minutes' then raise exception 'rate_limited'; end if;
    -- Cloudflare framför Supabase sätter cf-connecting-ip; utan header (SQL-editorn, service role) ingen spärr.
    ip := nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip';
    if ip is not null then
      h := md5((select value from app_secrets where key = 'ip_salt') || ip);
      if (select count(*) from report_ip_log where ip_hash = h and at > now() - interval '1 hour') >= 50 then
        raise exception 'ip_limited';
      end if;
      insert into report_ip_log (ip_hash) values (h);
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
