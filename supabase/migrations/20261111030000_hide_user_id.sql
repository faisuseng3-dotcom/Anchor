-- Steg 2 av 2. Körs FÖRST när klienten som läser `reporter` i stället för `user_id` är ute: den gamla klienten
-- läser select('*') och får "permission denied" när user_id inte längre får läsas.
-- Efter detta är user_id en hemlighet som bara enheten känner till, och delete_my_data(p_user_id) blir säker.
begin;

-- De gamla id:na ("user-…") har varit läsbara för alla. Bryt kopplingen: raderna får ett nytt id ingen känner till,
-- och klienten byter själv ut ett "user-…"-id mot ett nytt (getUserId). Samma salt i båda tabellerna, så att
-- notiser fortfarande inte går till den som skrev rapporten. Saltet sparas inte.
do $$
declare salt text := gen_random_uuid()::text;
begin
  update public.reports set user_id = 'legacy-' || md5(user_id || salt) where user_id like 'user-%';
  update public.reports set reporter = encode(sha256(convert_to(user_id, 'UTF8')), 'hex') where user_id like 'legacy-%';
  update public.push_subscriptions set user_id = 'legacy-' || md5(user_id || salt) where user_id like 'user-%';
end $$;

revoke select on public.reports from anon, authenticated;
grant select (id, venue_id, venue_name, queue_status, people_ahead, report_type, queue_session, comment, near_venue,
              created_at, expires_at, reporter) on public.reports to anon, authenticated;

-- Ersatt av delete_my_data. Med ett läsbart user_id stängde den av vem som helsts notiser.
drop function if exists public.delete_push_subscriptions(text);

commit;
