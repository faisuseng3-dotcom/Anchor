-- favorites, user_profiles och report_votes hade policyer med "ALL using (true)": vem som helst kunde läsa, ändra och
-- radera allas rader (verifierat mot pg_policies 2026-11-11). Webbappen läser och skriver dem inte längre. De töms och
-- stängs: utan policy nekar RLS allt för anon och authenticated. Service role och security definer påverkas inte.
-- Rättigheterna (grants) lämnas kvar med flit: en delete som RLS nekar ger noll rader, en saknad rättighet ger fel
-- 42501, och deleteAllUserData räknar ett fel som "kunde inte radera".
begin;

drop policy if exists "Anyone can manage favorites" on public.favorites;
drop policy if exists "Anyone can read favorites" on public.favorites;
drop policy if exists "Anyone can manage profiles" on public.user_profiles;
drop policy if exists "Anyone can read profiles" on public.user_profiles;
drop policy if exists "Anyone can vote" on public.report_votes;

truncate public.favorites, public.user_profiles, public.report_votes;

-- TRUNCATE går förbi RLS. REFERENCES och TRIGGER behöver klienten aldrig.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

commit;
