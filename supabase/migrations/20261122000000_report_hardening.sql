-- Inför App Store: rapporterna härdas (granskningen Q-11–Q-13, Q-15–Q-17). Alla funktioner behåller sina signaturer, så
-- appar som redan är ute fungerar som förut. Kör den här FÖRE klienten som läser reports.net (REPORT_COLUMNS i
-- src/main.js) driftsätts: utan kolumnen nekas hela läsningen.
--  1. IP-spärren slogs av tyst när cf-connecting-ip saknades. Nu används x-forwarded-for som reserv, och ett API-anrop
--     utan någon adress nekas ('ip_required'). Utan headers alls (SQL-editorn, pg_cron) ingen spärr, som förut.
--  2. venues: ställena som tar emot rapporter (VENUES i src/main.js plus qbar-demo). Okänt venue_id nekas
--     ('unknown_venue'), och venue_name tas härifrån i stället för ur klientens fritext. Fylls nedan med VENUES från
--     2026-11-22. Efter varje ändring i VENUES: node scripts/venue-names.mjs, kör sedan supabase/venues.sql.
--     queue_session får vara högst 40 tecken och user_id högst 100.
--  3. reports.net: en kort hash av nätet (IP-hashen plus kvällens datum), läsbar som reporter. "Minst 3 överens" räknas
--     per nät (qbar_estimate här, estimateWait i appen). Högst 2 kömätningar per nät och ställe på 45 min ('venue_ip_limited').
--     Avvägning: gäster på samma wifi eller bakom operatörens NAT räknas som en person och kan nekas en tredje rapport.
--     Det är priset för att en telefon med påhittade id inte ensam ska kunna visa "bekräftade" minuter.
--  4. En kömätning (initial) får inte ta en queue_session som redan finns ('session_taken'); förut kunde vem som helst
--     ta över en annans session.
--  5. På väg: start_on_my_way kontrollerar stället och har en IP-spärr. stop_on_my_way kräver ett riktigt id (minst 20
--     tecken); demoradernas id är kortare.
--  6. save_push_subscription: IP-spärr, och högst 50 ställen sparas per prenumeration.
begin;

-- ── 1. IP-spärren ───────────────────────────────────────────────────────────
-- En logg för alla spärrar; varje sort har sin egen kvot.
alter table public.report_ip_log add column if not exists kind text not null default 'report';

-- Returnerar en saltad hash av klientens IP-adress, eller null utan headers. Nekar ('ip_limited') när samma nät redan har
-- gjort p_max anrop av sorten p_kind den senaste timmen. x-forwarded-for: klienten kan skicka egna poster först, och
-- Supabase lägger till den riktiga adressen sist (github.com/orgs/supabase/discussions/34647). Därför tas den sista posten.
create or replace function public.qbar_ip_limit(p_kind text, p_max int) returns text
language plpgsql security definer set search_path = public as $$
declare
  hdr json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(nullif(hdr ->> 'cf-connecting-ip', ''),
                      nullif(btrim(split_part(hdr ->> 'x-forwarded-for', ',', -1)), ''));
  h text;
begin
  if ip is null then
    if hdr is not null then raise exception 'ip_required'; end if;
    return null;
  end if;
  h := md5((select value from app_secrets where key = 'ip_salt') || ip);
  if (select count(*) from report_ip_log where ip_hash = h and kind = p_kind and at > now() - interval '1 hour') >= p_max then
    raise exception 'ip_limited';
  end if;
  insert into report_ip_log (ip_hash, kind) values (h, p_kind);
  return h;
end $$;
revoke all on function public.qbar_ip_limit(text, int) from public, anon, authenticated;

-- ── 2. Kända ställen och längdgränser ──────────────────────────────────────
create table if not exists public.venues (id text primary key, name text not null);
alter table public.venues enable row level security;
revoke all on public.venues from anon, authenticated;
insert into public.venues (id, name) values
  ('360', '360°'),
  ('soap-bar', 'Soap Bar'),
  ('akkurat', 'Akkurat Bar & Restaurang'),
  ('tjoget', 'Tjoget'),
  ('sturehof', 'Sturehof'),
  ('pelikan', 'Pelikan'),
  ('morfar-ginko', 'Morfar Ginko'),
  ('spy-bar', 'Spy Bar'),
  ('fasching', 'Fasching'),
  ('berns', 'Berns'),
  ('lounge-bar', 'The Lounge Bar'),
  ('niva22', 'Nivå 22'),
  ('under-bron', 'Under Bron'),
  ('umganget', 'Umgänget'),
  ('kyoto', 'KYOTO'),
  ('ego', 'EGO'),
  ('sense-hyde', 'Sense / HYDE'),
  ('boqueria', 'Boqueria'),
  ('sodra-teatern', 'Södra Teatern'),
  ('hallwylska', 'Hallwylska'),
  ('rigoletto', 'Rigoletto'),
  ('lokal', 'LOKAL'),
  ('biblioteket-live', 'Biblioteket Live'),
  ('spice99', 'Spice99'),
  ('casa', 'CASA'),
  ('mister-french', 'Mister French'),
  ('sturecompagniet', 'Sturecompagniet'),
  ('kristall', 'Kristall'),
  ('golden-hits', 'Golden Hits'),
  ('neu', 'Neu'),
  ('nalen', 'Nalen'),
  ('mosebacke', 'Mosebacke Etablissement'),
  ('patricia', 'Patricia'),
  ('pharmarium', 'Pharmarium'),
  ('tak', 'TAK Stockholm'),
  ('hells-kitchen', 'Hell''s Kitchen'),
  ('20hundra5', '20hundra5'),
  ('afterglow', 'Afterglow'),
  ('alphabar', 'Alphabar'),
  ('american-bar', 'American Bar'),
  ('amici-nostri', 'Amici Nostri'),
  ('backdoor', 'Backdoor'),
  ('backstreet', 'Backstreet'),
  ('bagpipers-s-inn', 'Bagpipers Inn'),
  ('balthazar', 'Balthazar'),
  ('bar-a-vins', 'Bar à Vins'),
  ('bar-abrovinsch', 'Bar Abrovinsch'),
  ('bar-agrikultur', 'Bar Agrikultur'),
  ('bar-brooklyn', 'Bar Brooklyn'),
  ('bar-elisabeth', 'Bar Elisabeth'),
  ('bar-ingrid', 'Bar Ingrid'),
  ('bar-kaja', 'Bar Kaja'),
  ('bar-libertin', 'Bar Libertin'),
  ('bar-nacka', 'Bar Nacka'),
  ('bar-nimes', 'Bar Nîmes'),
  ('bar-nordic', 'Bar Nordic'),
  ('bar-oas', 'Bar oas'),
  ('bar-talea', 'Bar Talea'),
  ('bar08', 'Bar08'),
  ('bara-2-noll', 'Bara 2.Noll'),
  ('baras-backe', 'Baras Backe'),
  ('baras-gemenskap', 'Baras Gemenskap'),
  ('baras-stalle', 'Baras ställe'),
  ('batard', 'Bâtard'),
  ('beer-n-play', 'Beer n'' Play'),
  ('belgobaren', 'Belgobaren'),
  ('biljardpalatset', 'Biljardpalatset'),
  ('birka-bowling', 'Birka Bowling'),
  ('bistro-aspen', 'Bistro Aspen'),
  ('bistro-doma', 'Bistro Doma'),
  ('black-och-brown-inn', 'Black & Brown Inn'),
  ('black-elk', 'Black Elk'),
  ('blues-kok-och-bar', 'Blues Kök & Bar'),
  ('boule-bar', 'Boule Bar'),
  ('bron', 'Bron'),
  ('brother-tuck', 'Brother Tuck'),
  ('brannerian', 'Brännerian'),
  ('branneriet', 'Bränneriet'),
  ('cachette', 'Cachette'),
  ('cadierbaren', 'Cadierbaren'),
  ('cafe-caminito', 'Café Caminito'),
  ('charles-dickens', 'Charles Dickens'),
  ('chewie-s-bar', 'Chewie''s Bar'),
  ('city-biljard', 'City Biljard'),
  ('combo-vinbaren', 'Combo vinbaren'),
  ('compagniet-bar', 'Compagniet Bar'),
  ('continental-bar', 'Continental Bar'),
  ('coquetel-social', 'Coquetel social'),
  ('cork', 'Cork'),
  ('corno-strada', 'Corno Strada'),
  ('corvina', 'Corvina'),
  ('crazy-horse', 'Crazy Horse'),
  ('d-pub-och-bar', 'D. Pub & Bar'),
  ('debaser', 'Debaser'),
  ('demi', 'demi'),
  ('den-grone-jagaren', 'Den Gröne Jägaren'),
  ('diset', 'Diset'),
  ('dovas', 'Dovas'),
  ('dryck', 'Dryck'),
  ('eken', 'Eken'),
  ('embargo', 'Embargo'),
  ('engelen', 'Engelen'),
  ('enoteca-la-mela', 'Enoteca La Mela'),
  ('erlands', 'Erlands'),
  ('fabelbar', 'Fabelbar'),
  ('florabaren', 'Florabaren'),
  ('flygsektionen-t-centralen', 'Flygsektionen T-centralen'),
  ('flying-scotsman-inn', 'Flying Scotsman Inn'),
  ('fox-and-badger', 'Fox and Badger'),
  ('gamestreet-1', 'Gamestreet 1'),
  ('glada-hornan', 'Glada hörnan'),
  ('golf-baren-aspudden', 'Golf Baren Aspudden'),
  ('goma', 'Goma'),
  ('grain-cafe', 'Grain café'),
  ('grus-grus', 'Grus Grus'),
  ('grattan', 'Gråttan'),
  ('guldapan', 'Guldapan'),
  ('gullmarssons', 'Gullmarssons'),
  ('haket', 'Haket'),
  ('half-way-inn', 'Half Way Inn'),
  ('hallen-sodermalm', 'Hallen Södermalm'),
  ('harvest-home', 'Harvest Home'),
  ('hilma', 'Hilma'),
  ('hirschenkeller-gotgatan', 'Hirschenkeller, Götgatan'),
  ('hirschenkeller-sankt-eriksgatan', 'Hirschenkeller, Sankt Eriksgatan'),
  ('hirschenkeller-sveavagen', 'Hirschenkeller, Sveavägen'),
  ('holly-bush-bar-and-restaurant', 'Holly Bush Bar and Restaurant'),
  ('hommage', 'Hommage'),
  ('hop-och-vine', 'Hop & Vine'),
  ('hosoi', 'Hosoi'),
  ('house-of-q', 'House of Q'),
  ('humble-och-frank', 'Humble & Frank'),
  ('hus-7', 'Hus 7'),
  ('icebar', 'IceBar'),
  ('indigo', 'Indigo'),
  ('international', 'International'),
  ('international-bar-hantverkargatan', 'International Bar, Hantverkargatan'),
  ('international-bar-norrlandsgatan', 'International Bar, Norrlandsgatan'),
  ('japanese-pub-mix', 'Japanese Pub Mix'),
  ('john-scott-s-kungsgatan', 'John Scott’s Kungsgatan'),
  ('john-scott-s-kungstradgarden', 'John Scott’s Kungsträdgården'),
  ('jolo', 'Jolo'),
  ('karamell', 'Karamell'),
  ('katarina-olkafe', 'Katarina Ölkafé'),
  ('kelly-s', 'Kelly''s'),
  ('klosters-pub', 'Klosters pub'),
  ('klow', 'Klow'),
  ('kolingen', 'Kolingen'),
  ('kollektivet-livet', 'Kollektivet Livet'),
  ('krogen-soldaten-svejk', 'Krogen Soldaten Švejk'),
  ('krukan', 'Krukan'),
  ('l-a-bar', 'L.A. Bar'),
  ('laika', 'Laika'),
  ('le-hibou', 'Le Hibou'),
  ('legends', 'Legends'),
  ('lemon', 'Lemon'),
  ('leoparden', 'Leoparden'),
  ('lilla-hotellbaren', 'Lilla hotellbaren'),
  ('lilla-wien', 'Lilla Wien'),
  ('lion-bar-hornsgatan', 'Lion Bar, Hornsgatan 154'),
  ('lion-bar-hornsgatan-55', 'Lion Bar, Hornsgatan 55'),
  ('lion-bar-roslagsgatan', 'Lion Bar, Roslagsgatan'),
  ('lion-bar-sveavagen', 'Lion Bar, Sveavägen'),
  ('local-pub-och-eatery', 'Local Pub & Eatery'),
  ('loch-ness-taverna', 'Loch Ness Taverna'),
  ('loulou', 'Loulou'),
  ('lucy-s-flower-shop', 'Lucy’s Flower Shop'),
  ('mackinlay-s-inn', 'MacKinlay''s Inn'),
  ('map-petite-maison', 'MAP Petite Maison'),
  ('medis-kok-och-bar', 'Medis kök & bar'),
  ('meta', 'Meta'),
  ('mikkeller-sodermalm', 'Mikkeller Södermalm'),
  ('mister-plankstek', 'Mister Plankstek'),
  ('molly-malone-s', 'Molly Malone''s'),
  ('mondo', 'Mondo'),
  ('marthas', 'Märthas'),
  ('noppe-bar', 'Noppe Bar'),
  ('norra-brunn', 'Norra brunn'),
  ('norrport', 'Norrport'),
  ('o-connells', 'O''Connells'),
  ('o-learys-bowling', 'O''Learys Bowling'),
  ('o-learys-tolv', 'O''Learys Tolv'),
  ('o-learys-centralplan', 'O''Learys, Centralplan'),
  ('o-learys-slojdgatan', 'O''Learys, Slöjdgatan'),
  ('o-learys-sveavagen', 'O''Learys, Sveavägen'),
  ('old-beefeater-inn', 'Old Beefeater Inn'),
  ('old-george-inn', 'Old George Inn'),
  ('oliver-twist', 'Oliver Twist'),
  ('omnipollos-hatt', 'Omnipollos hatt'),
  ('one-tap-bar-och-food', 'One Tap Bar & Food'),
  ('oskar-s-kok-och-bar', 'Oskar''s kök & bar'),
  ('oxid-bar', 'Oxid Bar'),
  ('paradiso', 'Paradiso'),
  ('parken-soder', 'Parken Söder'),
  ('paulas', 'Paulas'),
  ('pet-sounds-bar', 'Pet Sounds Bar'),
  ('pinocchio-kok-och-bar', 'Pinocchio kök och bar'),
  ('pitcher-s', 'Pitcher''s'),
  ('polhem', 'Polhem'),
  ('pub-anchor', 'Pub Anchor'),
  ('pub-international', 'Pub International'),
  ('qbm', 'QBM'),
  ('queen-s-head', 'Queen''s Head'),
  ('racamaca', 'Racamaca'),
  ('replik', 'Replik'),
  ('restaurang-carmen', 'Restaurang Carmen'),
  ('restaurang-hjalmaren', 'Restaurang Hjälmaren'),
  ('retro-sankt-eriksgatan', 'Retro, Sankt Eriksgatan'),
  ('retro-sveavagen', 'Retro, Sveavägen'),
  ('rock-och-bowl', 'Rock & Bowl'),
  ('roq', 'RoQ'),
  ('savant-bar', 'savant bar'),
  ('shotluckan', 'Shotluckan'),
  ('side-track', 'Side Track'),
  ('skeppsbar', 'Skeppsbar'),
  ('skybar', 'SkyBar'),
  ('slakthuset', 'Slakthuset'),
  ('slaktkyrkan', 'Slaktkyrkan'),
  ('slm-stockholm', 'SLM Stockholm'),
  ('snabba-katten', 'Snabba Katten'),
  ('snaps', 'Snaps'),
  ('snovit', 'Snövit'),
  ('sofia-common', 'Sofia common'),
  ('sommarbaren', 'Sommarbaren'),
  ('st-andrews-inn', 'St Andrews Inn'),
  ('stampen', 'Stampen'),
  ('strandbryggan', 'Strandbryggan'),
  ('stringfellows', 'Stringfellows'),
  ('soder-biljarden', 'Söder Biljarden'),
  ('soderhallen-biljard', 'Söderhallen Biljard'),
  ('soderkallaren', 'Söderkällaren'),
  ('sodra-bar', 'Södra Bar'),
  ('sodra-sidan', 'Södra sidan'),
  ('takpark-by-urban-deli', 'Takpark by Urban Deli'),
  ('tekniska-hogskolans-studentkar', 'Tekniska Högskolans Studentkår'),
  ('television-brewing-co', 'Television Brewing Co.'),
  ('the-auld-dub', 'The Auld Dub'),
  ('the-big-ben', 'The Big Ben'),
  ('the-bishops-arms-bellmansgatan', 'The Bishops Arms, Bellmansgatan'),
  ('the-bishops-arms-odengatan', 'The Bishops Arms, Odengatan'),
  ('the-bishops-arms-sankt-eriksgatan', 'The Bishops Arms, Sankt Eriksgatan'),
  ('the-bishops-arms-tyska-brinken', 'The Bishops Arms, Tyska Brinken'),
  ('the-bishops-arms-vasagatan', 'The Bishops Arms, Vasagatan'),
  ('the-bull-and-bear-inn', 'The Bull and Bear Inn'),
  ('the-capital', 'The Capital'),
  ('the-central-bar-folkungagatan', 'The Central Bar, Folkungagatan'),
  ('the-central-bar-gotgatan', 'The Central Bar, Götgatan'),
  ('the-churchill-arms', 'The Churchill Arms'),
  ('the-doors', 'The Doors'),
  ('the-flying-dog', 'The Flying Dog'),
  ('the-flying-horse', 'The Flying Horse'),
  ('the-golden-bar', 'The Golden Bar'),
  ('the-king-s-fox', 'The King''s Fox'),
  ('the-liffey', 'The Liffey'),
  ('the-londoner', 'The Londoner'),
  ('the-mad-hatter', 'The Mad Hatter'),
  ('the-oaken-inn', 'The Oaken Inn'),
  ('the-old-brewer', 'The Old Brewer'),
  ('the-picts-bar', 'The Picts Bar'),
  ('the-ship', 'The Ship'),
  ('the-temple-bar', 'The Temple Bar'),
  ('time', 'Time'),
  ('tolvan', 'Tolvan'),
  ('tritonia', 'Tritonia'),
  ('tudor-arms', 'Tudor Arms'),
  ('tullen', 'Tullen'),
  ('tweed', 'Tweed'),
  ('tyge-och-sessil', 'Tyge & Sessil'),
  ('udda', 'Udda'),
  ('ugglan-boule-och-bar', 'Ugglan Boule & Bar'),
  ('viking-bar', 'Viking Bar'),
  ('vinfolket-drottninggatan', 'Vinfolket, Drottninggatan'),
  ('vinfolket-scheelegatan', 'Vinfolket, Scheelegatan'),
  ('vita-aperitivo', 'Vita Aperitivo'),
  ('voisine', 'Voisine'),
  ('vastra-skogen', 'Västra Skogen'),
  ('waku-waku', 'Waku waku'),
  ('wirstroms', 'Wirströms'),
  ('wirstroms-pub', 'Wirströms Pub'),
  ('yttons', 'Yttons'),
  ('zinkens-krog', 'Zinkens Krog'),
  ('asens-krog', 'Åsens krog'),
  ('algen', 'Älgen'),
  ('olbaronerna', 'Ölbaronerna'),
  ('olkontainen', 'Ölkontainen'),
  ('olstugan', 'Ölstugan'),
  ('olstugan-tullen-hantverkargatan', 'Ölstugan Tullen, Hantverkargatan'),
  ('olstugan-tullen-hornsgatan', 'Ölstugan Tullen, Hornsgatan'),
  ('qbar-demo', 'Qbar demo')
on conflict (id) do update set name = excluded.name;

-- not valid: gamla rader kontrolleras inte, bara nya.
alter table public.reports drop constraint if exists reports_queue_session_len;
alter table public.reports add constraint reports_queue_session_len check (char_length(queue_session) <= 40) not valid;
alter table public.reports drop constraint if exists reports_user_id_len;
alter table public.reports add constraint reports_user_id_len check (char_length(user_id) <= 100) not valid;

-- ── 3. Nätet ────────────────────────────────────────────────────────────────
alter table public.reports add column if not exists net text;
grant select (net) on public.reports to anon;
-- session_taken söker på queue_session i hela tabellen.
create index if not exists reports_queue_session_idx on public.reports (queue_session);

-- Samma funktion som i 20261115000000_ip_limit_and_queue_exits.sql, plus venues, net och session_taken.
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_initial timestamptz;
  s_started timestamptz; s_last timestamptz; s_count int; s_done boolean; s_venue text;
  h text;
begin
  new.created_at := now();
  new.expires_at := now() + interval '45 minutes';
  new.reporter := encode(sha256(convert_to(new.user_id, 'UTF8')), 'hex');
  new.net := null; -- sätts bara här, aldrig av klienten
  select name into new.venue_name from venues where id = new.venue_id;
  if not found then raise exception 'unknown_venue'; end if;
  if new.report_type = 'initial' then
    select max(created_at) into last_initial from public.reports
     where user_id = new.user_id and report_type = 'initial';
    if last_initial > now() - interval '5 minutes' then raise exception 'rate_limited'; end if;
    if new.queue_session is not null and exists (select 1 from reports where queue_session = new.queue_session) then
      raise exception 'session_taken';
    end if;
    h := qbar_ip_limit('report', 50);
    if h is not null then
      -- Kvällen börjar 06:00 svensk tid, som i appen: samma nät får samma hash hela natten.
      new.net := left(md5(h || ((now() at time zone 'Europe/Stockholm') - interval '6 hours')::date), 10);
      if (select count(*) from reports where venue_id = new.venue_id and net = new.net and report_type = 'initial'
            and created_at > now() - interval '45 minutes') >= 2 then
        raise exception 'venue_ip_limited';
      end if;
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

-- Samma funktion som i 20261118000000_krog.sql; bara "who" räknar nätet först (som estimateWait i src/main.js).
create or replace function public.qbar_estimate(p_venue text, p_at timestamptz, p_prior float8,
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
           near_venue is distinct from false site, coalesce(net, reporter, id::text) who
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

-- ── 5. På väg ───────────────────────────────────────────────────────────────
create or replace function public.start_on_my_way(p_user_id text, p_venue_id text, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_user_id), 0) not between 20 and 100 or not exists (select 1 from venues where id = p_venue_id) then
    raise exception 'ogiltigt anrop';
  end if;
  perform qbar_ip_limit('omw', 50);
  insert into on_my_way (user_id, venue_id, expires_at)
  values (p_user_id, p_venue_id, now() + make_interval(mins => least(greatest(coalesce(p_minutes, 0), 1), 60) + 15))
  on conflict (user_id) do update set venue_id = excluded.venue_id, expires_at = excluded.expires_at;
end $$;

create or replace function public.stop_on_my_way(p_user_id text) returns void
language sql security definer set search_path = public as $$
  delete from on_my_way where user_id = p_user_id and length(p_user_id) >= 20;
$$;

-- ── 6. Notiser ──────────────────────────────────────────────────────────────
-- Samma som i 20261112010000_launch_hardening.sql, plus spärren. Har någon fler än 50 favoriter sparas de första 50,
-- i stället för att notiserna slutar fungera helt.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_id text, p_venue_ids text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
     or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100
     or coalesce(length(p_user_id), 0) not between 1 and 100 or coalesce(cardinality(p_venue_ids), 0) > 400 then
    raise exception 'ogiltig prenumeration';
  end if;
  perform qbar_ip_limit('push', 50);
  insert into push_subscriptions (endpoint, p256dh, auth, user_id, venue_ids, updated_at)
  values (p_endpoint, p_p256dh, p_auth, p_user_id, coalesce(p_venue_ids[1:50], '{}'), now())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id,
        venue_ids = excluded.venue_ids, updated_at = now();
end $$;

commit;
