-- Steg 1 av 2 för att göra user_id hemligt. Bara tillägg: den gamla klienten fungerar som förut.
-- user_id var läsbart för alla och samtidigt nyckeln till delete_push_subscriptions(p_user_id). Nu:
--   reporter     = sha256(user_id), det enda andra ser (prognosens "≥2 personer", din historik)
--   delete_my_data(p_user_id) raderar dina rapporter och notiser; säkert först när user_id inte går att läsa (steg 2)
-- Plus: servern sätter expires_at själv (klienten kunde skicka 2099 och ligga kvar som färsk), och testraderna
-- ("seed-…", "anon-…" från september) tas bort ur produktionen.
begin;

alter table public.reports add column if not exists reporter text;

-- security definer: triggern läser user_id, som anon inte får läsa efter steg 2.
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_initial timestamptz;
  s_started timestamptz; s_last timestamptz; s_count int; s_done boolean; s_venue text;
begin
  new.created_at := now();
  new.expires_at := now() + interval '45 minutes';
  new.reporter := encode(sha256(convert_to(new.user_id, 'UTF8')), 'hex');
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

update public.reports set reporter = encode(sha256(convert_to(user_id, 'UTF8')), 'hex') where reporter is null;

delete from public.reports where user_id like 'seed-%' or user_id like 'anon-%';

create or replace function public.delete_my_data(p_user_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_user_id), 0) < 20 then raise exception 'ogiltigt id'; end if;
  delete from reports where user_id = p_user_id;
  delete from push_subscriptions where user_id = p_user_id;
end $$;
revoke all on function public.delete_my_data(text) from public;
grant execute on function public.delete_my_data(text) to anon, authenticated;

commit;
