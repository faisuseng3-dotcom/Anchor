-- Ångra din senaste rapport (Profil). Bara din egen (user_id är hemligt, så den som känner id:t är ägaren), bara en
-- kömätning (initial) och bara medan den syns i appen (45 min). Uppföljningar i samma kö-session tas bort med den, annars
-- stod en halv session kvar och mätte en dörrtakt från en rapport som inte finns. Returnerar antal borttagna rader.
begin;

create or replace function public.delete_my_report(p_user_id text, p_report_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s text; n int;
begin
  if coalesce(length(p_user_id), 0) < 20 then raise exception 'ogiltigt id'; end if;
  select queue_session into s from reports
   where id = p_report_id and user_id = p_user_id and report_type = 'initial' and created_at > now() - interval '45 minutes';
  if not found then return 0; end if;
  delete from reports where user_id = p_user_id and (id = p_report_id or (s is not null and queue_session = s));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.delete_my_report(text, uuid) from public;
grant execute on function public.delete_my_report(text, uuid) to anon, authenticated;

commit;
