-- Qbar för krogar (krog.html). Ställen med avtal loggar in med en e-postlänk (Supabase Auth), skriver "Din rad i Qbar"
-- och ser sammanställd statistik om sin egen kö. Inga enskilda rapporter och inga användar-id lämnar databasen:
-- venue_stats() räknar allt här och returnerar bara siffror för det inloggade stället.
--
-- qbar_rates, qbar_prior och qbar_estimate är väntetidsmodellen i src/main.js (sessionRates, historicalRateFor,
-- estimateWait, formatWait/reportedText, waitToStatus) i SQL. Ändras modellen där: ändra här, tests/krog.test.js larmar.
begin;

-- Avtalen: en rad per e-post som får logga in. Läggs till för hand (supabase/README.md). Nås bara via funktionerna.
create table public.venue_accounts (
  email    text primary key check (email = lower(email)),
  venue_id text not null,
  -- Kopia av venue.pace i VENUES (src/main.js): startgissningen för dörrtakten när inga mätningar finns.
  pace     text not null default 'normal' check (pace in ('slow', 'normal', 'fast'))
);
alter table public.venue_accounts enable row level security;
revoke all on public.venue_accounts from anon, authenticated;

-- Raden i kapseln ("Från stället ✓"). Alla läser, bara stället skriver (save_venue_note). Ingen del av modellen läser
-- tabellen, så den påverkar aldrig väntetiden.
create table public.venue_notes (
  venue_id   text primary key,
  entry      text check (char_length(entry) <= 40),
  guestlist  text check (char_length(guestlist) <= 40),
  tonight    text check (char_length(tonight) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.venue_notes enable row level security;
revoke all on public.venue_notes from anon, authenticated;
grant select on public.venue_notes to anon, authenticated;
create policy "Alla läser raden" on public.venue_notes for select using (true);

-- Inloggat ställe. E-posten läses ur auth.users och måste vara bekräftad: JWT:ns e-post kan vara obekräftad om
-- registrering med lösenord någon gång slås på.
create function public.krog_venue() returns text
language sql stable security definer set search_path = public as $$
  select a.venue_id from venue_accounts a join auth.users u on lower(u.email) = a.email
   where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create function public.save_venue_note(p_entry text, p_guestlist text, p_tonight text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := krog_venue();
begin
  if v is null then raise exception 'inget avtal'; end if;
  insert into venue_notes (venue_id, entry, guestlist, tonight, updated_at)
  values (v, nullif(btrim(p_entry), ''), nullif(btrim(p_guestlist), ''), nullif(btrim(p_tonight), ''), now())
  on conflict (venue_id) do update
    set entry = excluded.entry, guestlist = excluded.guestlist, tonight = excluded.tonight, updated_at = now();
end $$;

-- ── Modellen ────────────────────────────────────────────────────────────────
-- AHEAD_BUCKETS: index 0–4 för mittvärdena 0, 5, 17, 37, 60.
create function public.qbar_bucket(n float8) returns int language sql immutable as $$
  select (n >= 5)::int + (n >= 17)::int + (n >= 37)::int + (n >= 60)::int;
$$;

-- sessionRates: en takt per kö-session (första → sista mätpunkten) bland rapporterna i [p_from, p_to].
create function public.qbar_rates(p_venue text, p_from timestamptz, p_to timestamptz)
returns table (rate float8, started_at timestamptz)
language sql stable set search_path = public as $$
  with s as (
    select min(created_at) t0,
           -- I millisekunder och float8, som JavaScripts (last - first) / 60000.
           (extract(epoch from max(created_at) - min(created_at)) * 1000)::float8 / 60000 mins,
           (array_agg(people_ahead order by created_at))[1]::float8 a0,
           (array_agg(people_ahead order by created_at desc))[1]::float8 a1
      from reports
     where venue_id = p_venue and queue_session is not null and people_ahead is not null
       and created_at between p_from and p_to
     group by queue_session having count(*) >= 2
  ), w as (select *, a0 - a1 moved, (array[0, 9, 15, 25, 30])[qbar_bucket(a0) + 1] width from s)
  select case when moved > 0 then moved / mins else width::float8 / 2 / mins end, t0
    from w
   where mins between 4 and 90 and moved >= 0 and (moved > 0 or (mins >= 10 and width > 0));
$$;

-- historicalRateFor: medianen av tidigare kvällars takter samma veckodag (kvällen börjar 06:00), ±1 timme, minst 3,
-- utom kvällen kring p_at. Annars startgissningen per venue.pace.
create function public.qbar_prior(p_rates float8[], p_starts timestamptz[], p_at timestamptz, p_pace float8) returns float8
language sql stable as $$
  select case when count(*) >= 3 then percentile_cont(0.5) within group (order by r) else p_pace end
    from unnest(p_rates, p_starts) x(r, s),
         lateral (select abs(extract(hour from s at time zone 'Europe/Stockholm')
                           - extract(hour from p_at at time zone 'Europe/Stockholm')) dh) h
   where abs(extract(epoch from s - p_at)) >= 12 * 3600
     and extract(dow from (s - interval '6 hours') at time zone 'Europe/Stockholm')
       = extract(dow from (p_at - interval '6 hours') at time zone 'Europe/Stockholm')
     and least(dh, 24 - dh) <= 1;
$$;

-- estimateWait vid p_at, med texten (formatWait, eller reportedText utan minuter) och statusen appen hade visat.
-- ahead är null när ingen kömätning finns.
create function public.qbar_estimate(p_venue text, p_at timestamptz, p_prior float8,
  out ahead float8, out mins float8, out low int, out high int, out confirmed boolean, out is_full boolean,
  out fresh int, out wait_text text, out status text)
language plpgsql stable set search_path = public as $$
declare
  vals float8[]; all_a float8[]; all_who text[]; n int; mr float8; rate float8; spread float8; lo float8; hi float8;
  conflict boolean := false;
begin
  -- Basis: färska (<20 min) på plats, annars alla färska; utan färska den senaste (på plats om någon finns).
  with c as (
    select people_ahead::float8 a, created_at, created_at > p_at - interval '20 minutes' f,
           near_venue is distinct from false site, coalesce(reporter, id::text) who
      from reports
     where venue_id = p_venue and report_type = 'initial' and people_ahead is not null
       and created_at <= p_at and created_at > p_at - interval '45 minutes'
  )
  select coalesce((select array_agg(a) from c where f and site), (select array_agg(a) from c where f),
                  (select array[a] from c order by site desc, created_at desc limit 1)),
         (select count(*) from c where f), (select array_agg(a) from c), (select array_agg(who) from c)
    into vals, fresh, all_a, all_who;
  if vals is null then return; end if;

  select percentile_cont(0.5) within group (order by v) into ahead from unnest(vals) v;
  select count(*), percentile_cont(0.5) within group (order by r.rate) into n, mr
    from qbar_rates(p_venue, p_at - interval '45 minutes', p_at) r;
  rate := case when n > 0 then (n * mr + 2 * p_prior) / (n + 2) else p_prior end;
  select count(distinct w) >= 3 into confirmed from unnest(all_a, all_who) x(a, w) where qbar_bucket(a) = qbar_bucket(ahead);
  is_full := false; mins := 0; low := 0; high := 0;

  if ahead > 0 then
    is_full := n >= 2 and mr < 0.3 and ahead >= 10;
    mins := ahead / rate;
    spread := case when n >= 3 then 0.2 else 0.35 end;
    -- floor(x + 0.5) = JavaScripts Math.round; round() på float8 avrundar till jämnt.
    low := floor(mins * (1 - spread) / 5 + 0.5) * 5;
    high := greatest(5, floor(mins * (1 + spread) / 5 + 0.5) * 5);
    select min(v), max(v) into lo, hi from unnest(vals) v;
    conflict := qbar_bucket(hi) - qbar_bucket(lo) >= 2;
    if conflict then
      low := least(low, floor(lo / rate / 5 + 0.5) * 5);
      high := greatest(high, floor(hi / rate / 5 + 0.5) * 5);
    end if;
  end if;

  wait_text := case
    when not confirmed then case when conflict then 'Går isär' when ahead = 0 then 'Ingen kö'
      else (array['Ingen kö', '1–10', '10–25', '25–50', '50+'])[qbar_bucket(ahead) + 1] || ' i kö' end
    when is_full then 'Fullt'
    when ahead = 0 then 'Ingen kö'
    when high <= 5 then '<5 min'
    when high > 60 then low || '+ min'
    when low < 5 then '<' || high || ' min'
    when low = high then '~' || low || ' min'
    else low || '–' || high || ' min' end;
  status := case when not confirmed then 'few' when is_full then 'long' when ahead = 0 then 'none'
    when mins < 18 then 'short' when mins < 30 then 'medium' else 'long' end;
end $$;

-- ── Statistiken för det inloggade stället ──────────────────────────────────
-- Bara siffror: väntetiden nu, antal på väg (från 3, som i appen), antal kömätningar i kväll och samma tid förra
-- veckan, kön var 15:e minut 20–03 i kväll och samma kväll förra veckan, och snittet per veckodag och timme 8 veckor
-- bakåt. En kurva eller ruta har bara tider då appen visade minuter (minst 3 personer överens).
create function public.venue_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v text; pace float8; rates float8[]; starts timestamptz[];
  night timestamp := ((now() - interval '6 hours') at time zone 'Europe/Stockholm')::date; -- kvällens datum, 00:00
  night_start timestamptz := (night + interval '6 hours') at time zone 'Europe/Stockholm';
  e record; omw int;
begin
  select a.venue_id, case a.pace when 'slow' then 1.0 when 'fast' then 3.0 else 2.0 end -- PACE_RATE
    into v, pace from venue_accounts a where a.venue_id = krog_venue() limit 1;
  if v is null then raise exception 'inget avtal'; end if;

  select array_agg(r.rate), array_agg(r.started_at) into rates, starts
    from qbar_rates(v, now() - interval '8 weeks', now()) r;
  select * into e from qbar_estimate(v, now(), qbar_prior(rates, starts, now(), pace));
  select count(*) into omw from on_my_way where venue_id = v and expires_at > now();

  return json_build_object(
    'venue_id', v,
    'now', case when e.ahead is not null then json_build_object('text', e.wait_text, 'status', e.status, 'fresh', e.fresh) end,
    'on_way', case when omw >= 3 then omw end,
    'reports_tonight', (select count(*) from reports where venue_id = v and report_type = 'initial'
                          and created_at >= night_start),
    'reports_last_week', (select count(*) from reports where venue_id = v and report_type = 'initial'
                            and created_at >= night_start - interval '7 days' and created_at <= now() - interval '7 days'),
    -- Minuter var 15:e minut 20:00–03:00 (29 punkter, null utan minuter). I kväll bara fram till nu.
    'tonight', (select json_agg(case when x.confirmed then round(x.mins::numeric, 1) end order by t)
        from generate_series(night + interval '20 hours', night + interval '27 hours', interval '15 minutes') l,
             lateral (select l at time zone 'Europe/Stockholm' t) tt,
             lateral qbar_estimate(v, t, qbar_prior(rates, starts, t, pace)) x
       where t <= now()),
    'last_week', (select json_agg(case when x.confirmed then round(x.mins::numeric, 1) end order by t)
        from generate_series(night - interval '7 days' + interval '20 hours', night - interval '7 days' + interval '27 hours',
                             interval '15 minutes') l,
             lateral (select l at time zone 'Europe/Stockholm' t) tt,
             lateral qbar_estimate(v, t, qbar_prior(rates, starts, t, pace)) x),
    -- Snitt per kvällens veckodag (0 = söndag) och timme. Ett snitt av en enda kväll är ingen vana: minst två kvällar.
    'heat', (select json_agg(json_build_object('dow', wd, 'hour', hr, 'mins', round(avg_mins::numeric),
               'status', case when avg_mins = 0 then 'none' when avg_mins < 18 then 'short'
                              when avg_mins < 30 then 'medium' else 'long' end)) from (
        select extract(dow from d)::int wd, extract(hour from l)::int hr, avg(x.mins) avg_mins
          from generate_series(night - interval '56 days', night - interval '1 day', interval '1 day') d,
               generate_series(d + interval '20 hours', d + interval '27 hours 45 minutes', interval '15 minutes') l,
               lateral (select l at time zone 'Europe/Stockholm' t) tt,
               lateral qbar_estimate(v, t, qbar_prior(rates, starts, t, pace)) x
         where x.confirmed
         group by 1, 2 having count(distinct d) >= 2) h)
  );
end $$;

revoke all on function public.krog_venue(), public.qbar_bucket(float8), public.qbar_rates(text, timestamptz, timestamptz),
  public.qbar_prior(float8[], timestamptz[], timestamptz, float8), public.qbar_estimate(text, timestamptz, float8),
  public.save_venue_note(text, text, text), public.venue_stats() from public, anon, authenticated;
grant execute on function public.save_venue_note(text, text, text), public.venue_stats() to authenticated;

commit;
