-- Spärr per nät. 20-minutersspärren gäller per user_id, och ett nytt id kostar bara en rensad localStorage, så ett
-- skript kunde fylla ett ställe med falska köer. Nu: högst 10 kömätningar i timmen från samma IP-adress, oavsett id.
-- IP-adressen sparas aldrig, bara md5(hemligt salt || ip) i en timme; saltet finns bara i databasen, så hashen går
-- inte att räkna tillbaka. 10 i timmen räcker för ett helt sällskap på krogens wifi.
begin;

create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (key, value) values ('ip_salt', gen_random_uuid()::text) on conflict (key) do nothing;

create table if not exists public.report_ip_log (ip_hash text not null, at timestamptz not null default now());
create index if not exists report_ip_log_hash_at on public.report_ip_log (ip_hash, at);
alter table public.report_ip_log enable row level security;
revoke all on public.report_ip_log from anon, authenticated;

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
    if last_initial > now() - interval '20 minutes' then raise exception 'rate_limited'; end if;
    -- Cloudflare framför Supabase sätter cf-connecting-ip; utan header (SQL-editorn, service role) ingen spärr.
    ip := nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip';
    if ip is not null then
      h := md5((select value from app_secrets where key = 'ip_salt') || ip);
      if (select count(*) from report_ip_log where ip_hash = h and at > now() - interval '1 hour') >= 10 then
        raise exception 'ip_limited';
      end if;
      insert into report_ip_log (ip_hash) values (h);
    end if;
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

commit;

-- IP-loggen behövs bara en timme; jobbet rensar den var 15:e minut.
select cron.schedule('qbar-iplogg', '*/15 * * * *', $$ delete from public.report_ip_log where at < now() - interval '1 hour' $$);
