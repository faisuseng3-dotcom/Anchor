-- "På väg": klienten har anropat de här tre funktionerna sedan länge, men de fanns inte i produktionen (404), så
-- "N på väg" visades aldrig. En rad per användare; den gäller tills du borde vara framme, plus 15 minuter.
-- Tabellen nås bara via funktionerna (RLS utan policyer). Antalen visas först från 3, så en enskild person syns aldrig.
begin;

create table if not exists public.on_my_way (
  user_id    text primary key,
  venue_id   text not null,
  expires_at timestamptz not null
);
alter table public.on_my_way enable row level security;
revoke all on public.on_my_way from anon, authenticated;

create or replace function public.start_on_my_way(p_user_id text, p_venue_id text, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_user_id), 0) < 20 or coalesce(length(p_venue_id), 0) not between 1 and 100 then
    raise exception 'ogiltigt anrop';
  end if;
  insert into on_my_way (user_id, venue_id, expires_at)
  values (p_user_id, p_venue_id, now() + make_interval(mins => least(greatest(coalesce(p_minutes, 0), 1), 60) + 15))
  on conflict (user_id) do update set venue_id = excluded.venue_id, expires_at = excluded.expires_at;
end $$;

create or replace function public.stop_on_my_way(p_user_id text) returns void
language sql security definer set search_path = public as $$
  delete from on_my_way where user_id = p_user_id;
$$;

create or replace function public.on_my_way_counts() returns table (venue_id text, n bigint)
language sql stable security definer set search_path = public as $$
  select venue_id, count(*) from on_my_way where expires_at > now() group by venue_id having count(*) >= 3;
$$;

-- Radera min data tar också "på väg".
create or replace function public.delete_my_data(p_user_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_user_id), 0) < 20 then raise exception 'ogiltigt id'; end if;
  delete from reports where user_id = p_user_id;
  delete from push_subscriptions where user_id = p_user_id;
  delete from on_my_way where user_id = p_user_id;
end $$;

revoke all on function public.start_on_my_way(text, text, int), public.stop_on_my_way(text),
  public.on_my_way_counts() from public;
grant execute on function public.start_on_my_way(text, text, int), public.stop_on_my_way(text),
  public.on_my_way_counts() to anon, authenticated;

commit;
