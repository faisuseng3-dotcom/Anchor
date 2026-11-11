-- Notiser om favoriter: en rad per telefon som slagit på notiser, med favoriternas venue-id.
-- Anon når tabellen bara via funktionerna nedan (RLS utan policyer), så ingen kan läsa andras favoriter eller adresser.

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  user_id    text not null,
  venue_ids  text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_venue_ids_idx on public.push_subscriptions using gin (venue_ids);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- Slår på notiser eller uppdaterar favoriterna. Adressen är telefonens egen och går inte att gissa.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_id text, p_venue_ids text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100
     or coalesce(length(p_user_id), 0) not between 1 and 100 or coalesce(cardinality(p_venue_ids), 0) > 400 then
    raise exception 'ogiltig prenumeration';
  end if;
  insert into push_subscriptions (endpoint, p256dh, auth, user_id, venue_ids, updated_at)
  values (p_endpoint, p_p256dh, p_auth, p_user_id, coalesce(p_venue_ids, '{}'), now())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id,
        venue_ids = excluded.venue_ids, updated_at = now();
end $$;

-- Stänger av notiser på en telefon.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;

-- "Radera min data": alla telefoner med samma anonyma id.
create or replace function public.delete_push_subscriptions(p_user_id text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where user_id = p_user_id;
$$;

revoke all on function public.save_push_subscription(text, text, text, text, text[]) from public;
revoke all on function public.delete_push_subscription(text) from public;
revoke all on function public.delete_push_subscriptions(text) from public;
grant execute on function public.save_push_subscription(text, text, text, text, text[]) to anon, authenticated;
grant execute on function public.delete_push_subscription(text) to anon, authenticated;
grant execute on function public.delete_push_subscriptions(text) to anon, authenticated;
