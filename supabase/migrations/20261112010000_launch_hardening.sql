-- Inför App Store-lanseringen.
begin;

-- 1. Kommentarer finns inte längre. Fri text som andra ser kräver filter, anmälan och blockering (App Store 1.2).
-- Kolumnen och läsrätten står kvar så att en flik som laddats före ändringen inte får fel; texten sparas aldrig.
update public.reports set comment = null where comment is not null;
create or replace function public.reports_no_comment() returns trigger language plpgsql as $$
begin
  new.comment := null;
  return new;
end $$;
drop trigger if exists reports_no_comment on public.reports;
create trigger reports_no_comment before insert on public.reports for each row execute function public.reports_no_comment();

-- 2. Notiser bara till webbläsarnas push-tjänster. Med vilken https-adress som helst kunde någon lägga in tusentals
-- adresser till en server den vill sänka, och varje ny rapport skickade då ett anrop till var och en.
delete from public.push_subscriptions
 where endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/';
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_id text, p_venue_ids text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
     or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100
     or coalesce(length(p_user_id), 0) not between 1 and 100 or coalesce(cardinality(p_venue_ids), 0) > 400 then
    raise exception 'ogiltig prenumeration';
  end if;
  insert into push_subscriptions (endpoint, p256dh, auth, user_id, venue_ids, updated_at)
  values (p_endpoint, p_p256dh, p_auth, p_user_id, coalesce(p_venue_ids, '{}'), now())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id,
        venue_ids = excluded.venue_ids, updated_at = now();
end $$;

commit;
