# QueueBar — Datamodell

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).

> ## Var schemat finns
>
> Policyer, funktioner, triggrar och begränsningar lästes ur produktionen 2026-11-11
> (`npx supabase db query --remote=awwmfsjsrjktekmbgadx --read-only`). Ändringar sedan dess ligger i
> `supabase/migrations/`. Tabellerna `reports`, `favorites`, `user_profiles` och `report_votes` skapades i webbgränssnittet
> och har ingen `create table` i repot; avsnitten nedan beskriver dem som de såg ut då.

Inga nycklar, lösenord eller produktionsdata återges i detta dokument. Supabase-URL och den publika
anon-nyckeln ligger i klartext i `src/main.js`; se säkerhetsavsnittet längst ned.

---

## 1. `VENUES` — ställena

**Ställena ligger inte i databasen.** De är en hårdkodad array på 310 objekt i
`src/main.js`. Att lägga till, ta bort eller flytta ett ställe är en **kodändring och en
deploy**, inte en databasuppdatering.

| Fält | Typ | Exempel | Används av |
|---|---|---|---|
| `id` | string, primärnyckel | `'spy-bar'` | Kopplar rapporter till ställe. Hamnar i `onclick`-attribut. |
| `name` | string | `'Spy Bar'` | Visas överallt. Behandlas som betrodd (ej escapad). |
| `address` | string | `'Birger Jarlsgatan 20'` | Visas i venue-kort, sökbart (poäng 20). |
| `area` | string | `'Östermalm'` | Visas, sökbart (poäng 30–40), gruppering. |
| `type` | `'bar'` \| `'klubb'` | `'klubb'` | Filter i Utforska, väljer kartikon (glas/not). |
| `lat`, `lng` | number | `59.3360, 18.0730` | Kartnål, avstånd och gångtid (`distanceKmTo`), "Bäst nu". |
| `closing` | `HH:MM` \| `null`, eller sju sådana måndag–söndag där `false` = stängt den kvällen | `'05:00'`, `[false, false, '05:00', '05:00', '05:00', '05:00', false]` | `closingTonight()` → `minutesToClose()` / `isClosed()` → "Stängt", "Stänger 01:00", "Bäst nu", "hinner du". Natten hör till dagen den började. `null` = okänd: aldrig "Stängt", ingen stängningsrad. |
| `pace` | `'slow'` \| `'normal'` \| `'fast'` | `'slow'` | **Startgissning för dörrtakt** innan mätningar finns. Se [QUEUE_LOGIC.md](QUEUE_LOGIC.md). |

Alla 310 objekt har samtliga nio fält (test i `tests/venues.test.js`). 16 av dem är dolda, se nedan.

### Var ställena kommer från

- **De 28 ursprungliga** (id som `spy-bar`, `kristall`) är handskrivna. Deras `pace` är bedömningar; `closing` kommer ur
  OSM där stället finns där (Spy Bar, Sturecompagniet, Patricia m.fl.), annars är den också en bedömning.
- **280 från OpenStreetMap** (`amenity=bar|pub|nightclub` inom bboxen i `scripts/fetch-osm-venues.mjs`,
  körd 2026-11-03), utom de som redan fanns under samma namn (även "The Soap Bar" = Soap Bar). © OpenStreetMap-bidragsgivare, ODbL.
  - `type`: `nightclub` → `'klubb'`, `bar`/`pub` → `'bar'`. `pace`: `'normal'` för klubb, `'fast'` för bar.
  - `address`: OSM:s egna `addr:*`-taggar, annars närmaste OSM-adress inom 40 m, annars gatan.
  - `area`: stadsdel från Nominatim.
  - `closing`: stängning per kväll ur OSM:s `opening_hours` (2026-11-11, ur `data/venues_candidates.json`). ";" skriver
    över, "," lägger till, en dag som inte nämns är stängd, utom mellan två öppna dagar (troligen utelämnad, då `null`).
    Samma tid alla dagar skrivs som en tid. Saknas den, eller går den inte att tolka ("17:00+", veckonummer), är den
    `null` (78 ställen). Ingen gissning: en gissad tid visade öppna ställen som stängda. Jolo fick fredag–lördag `null`
    för hand (saknas i OSM).
  - Kedjor med samma namn (The Bishops Arms, O'Learys) får gatan efter namnet: "The Bishops Arms, Vasagatan".

### Stängda ställen

- **Permanent stängda** raderas ur `VENUES`: Gro, Gemla Vinbar, El Clasico, Ben's Bar, Jacqueline's, Proseccobaren (2026-11-03).
- **Tillfälligt stängda eller oklara** står i `HIDDEN_VENUES` med skäl och tas bort ur `VENUES` när appen startar, så
  de syns inte någonstans. Rapporter med deras `venue_id` filtreras bort av `loadReports` som alla okända id.
  Öppnar stället igen: ta bort raden i `HIDDEN_VENUES`.

### Verifierade problem i venue-datan

- **Täta kvarter**: runt Stureplan och i Gamla stan ligger ställen några meter isär. Krockande pillar visas som en pill
  med "+N" (`declutterPills`) tills man zoomar in; Hell's Kitchen och Sturecompagniet (3 m) skiljs inte ens vid zoom 18.
- *(rättat 2026-11-03)* Nio av de 28 ursprungliga låg 79–398 m fel. Nu har de OSM:s position, kontrollerad mot adressen
  med Nominatim (inom 27 m). Café Opera (81 m) är orättad eftersom den är dold.
- OSM vet inte om ett ställe har stängt för gott. Ett nedlagt ställe syns tills någon tar bort det ur `VENUES`.

`tests/venues.test.js` kontrollerar fält, unika id/namn/koordinater och att allt ligger i Stockholm.
`scripts/check.js` kontrollerar att 17 testdata-id:n finns och att varje objekt har `pace`.

---

## 2. `reports` — körapporterna

Den enda tabell appen både läser och skriver i stor omfattning.

### Kolumner appen använder

| Kolumn | Skrivs av klienten | Läses | Innehåll |
|---|---|---|---|
| `id` | nej | nej | **OVERIFIERAT** — antas primärnyckel satt av databasen |
| `created_at` | **nej** | ja, överallt | Sätts av triggern `reports_guard` (`now()`), oavsett vad klienten skickar. All färskhetslogik bygger på den. |
| `venue_id` | **ja** | ja | Matchar `VENUES[].id`. Hamnar i `onclick` — se XSS-noten nedan. |
| `venue_name` | **ja** | ja (reserv) | Denormaliserat namn. Escapas vid rendering. |
| `user_id` | **ja** | **nej** | Slumpat id från `localStorage.qb_user_id` (`getUserId`, 128 bitar). **Hemligt:** anon får inte läsa kolumnen, och id:t är nyckeln till `delete_my_data`. |
| `reporter` | nej | ja | `sha256(user_id)`, satt av `reports_guard`. Prognosens "≥2 personer", spärren och historiken. Klienten sparar sin egen från svaret på första rapporten (`qb_reporter`). |
| `queue_status` | **ja** | ja | `'none'`\|`'short'`\|`'medium'`\|`'long'`. Beräknas i klienten med `waitToStatus()`. |
| `people_ahead` | **ja** | ja | Heltal: knappens **mittvärde** (0, 5, 17, 37 eller 60), inte ett exakt antal. |
| `report_type` | **ja** | ja | `'initial'` \| `'followup'` \| `'entered'`. Saknas på äldre rader → behandlas som `'initial'`. |
| `queue_session` | **ja** | ja | `'qs-<base36>-<slump>'`. Binder ihop en persons mätpunkter i samma kö. |
| `expires_at` | ja, men skrivs över | ja (filter) | `created_at + 45 min`, satt av `reports_guard`. `loadReports` filtrerar på den. |
| `comment` | ja, om ifylld | ja | Max 80 tecken (CHECK i databasen). **Escapas** vid rendering. |

Begränsningar i databasen: `people_ahead` 0–200, `queue_status` och `report_type` bara de kända värdena, `comment` ≤ 80.
`reports_guard` (BEFORE INSERT, security definer) spärrar en ny `initial` inom 20 min från samma `user_id`
(`rate_limited`) och kräver att uppföljningar hör till en egen, öppen session (`session_*`, `too_soon` under 3 min).

### Så här används `people_ahead`

Värdet är **inte** ett antal personer användaren räknat. Det är mittvärdet i det intervall
användaren tryckte på (`AHEAD_BUCKETS`, `src/main.js`):

| Knapp | Lagrat `people_ahead` | Intervallbredd |
|---|---|---|
| Ingen kö | 0 | 0 |
| 1–10 | 5 | 9 |
| 10–25 | 17 | 15 |
| 25–50 | 37 | 25 |
| 50+ | 60 | 30 |

Bredden används när samma person rapporterar samma intervall två gånger: rörelsen är då okänd men
mindre än intervallets bredd. Detta är avsiktligt och ska inte "städas bort".

### Rapporttyperna

```
initial    Mäter kölängden. Startar en queue_session (inte vid "Ingen kö", och inte när man är långt
           från stället — isFarFrom, >300 m minus GPS-noggrannhet). Enda typen som räknas som en
           kömätning (isQueueReport). Ger 10 poäng. Har man redan en session på samma ställe blir
           rapporten i stället en followup/entered.
followup   "Står du kvar?" — en ny position i SAMMA kö. Mäter hur snabbt kön rör sig.
           Räknas INTE som en kömätning. Minst 4 min mellan varje, max 4 stycken.
entered    "Jag är inne" — people_ahead = 0. Avslutar sessionen, ger den verkliga
           väntetiden och används för kalibrering. Ger 5 poäng. Mer än 20 min efter senaste
           punkten (QS_STALE_GAP) frågar bannern "Kom du in nyss?"; "Tidigare" avslutar
           sessionen lokalt utan att skicka (en sen tryckning gav takten 0,53 i stället för ~2,5).
```

Inga rapporter skickas i testläge ("Testläge — inget skickas") och stängda ställen går inte att
rapportera.

### Läsfrågor

| Funktion | Fråga | Gräns |
|---|---|---|
| `loadReports` | `select * where expires_at >= nu order by created_at desc` | **limit 1000** (B-05) |
| `loadHistoricalPatterns` | `select venue_id, queue_status, created_at where created_at >= 8 v, report_type = 'initial' order by created_at desc` — "Ingen kö" räknas med, kvällen just nu (senaste 12 h) räknas bort i klienten | **limit 1000** |
| `loadHistoricalRates` | `select venue_id, queue_session, people_ahead, report_type, created_at where queue_session not null, created_at >= 8 v order by created_at desc` | **limit 1000** |
| `loadUserHistory` | `select id, queue_session, report_type, created_at where user_id = mitt` — profilen räknar unika kö-sessioner; "–" medan den hämtar eller om den misslyckas | ingen |

---

## 3. `favorites`

| Kolumn | Skrivs | Läses |
|---|---|---|
| `user_id` | nej | nej |
| `venue_id` | nej | nej |

**Tömd och stängd 2026-11-11** (`supabase/migrations/20261111010000_lock_legacy_tables.sql`). Policyn var
`ALL using (true)`: vem som helst kunde läsa, ändra och radera allas favoriter. Nu finns ingen policy, så RLS nekar
allt. Favoriter finns i `localStorage.qb_favorites` och följer inte med mellan enheter. Med notiser på finns en kopia i
`push_subscriptions` (nedan), som bara servern läser.

---

## 3b. `push_subscriptions` — notiser om favoriter

Schemat finns i repot: `supabase/migrations/20261111000000_push_subscriptions.sql`. Uppsättning: `supabase/README.md`.

| Kolumn | Innehåll |
|---|---|
| `endpoint` (pk) | Telefonens notisadress hos Apple/Google |
| `p256dh`, `auth` | Nycklarna som notisen krypteras med |
| `user_id` | Samma anonyma id som i `reports`; den egna rapporten ger ingen notis |
| `venue_ids` | Favoriterna, skrivs om vid varje ändrad favorit (`syncPushFavorites`) |

RLS är på utan policyer: anon når tabellen bara via `save_push_subscription` (slå på / uppdatera favoriter),
`delete_push_subscription(p_endpoint)` (stäng av) och `delete_my_data` (Radera min data). Edge Function
`notify-favorites` läser med service role. En rad vars adress svarar 404/410 tas bort när den försöker skicka.

---

## 4. `user_profiles`

**Tömd och stängd 2026-11-11**, som `favorites` och `report_votes` (samma migrering; alla tre hade `ALL using (true)`).
Appen rör inte tabellerna. Poängen räknas i klienten i `updateProfileStats()` ur de egna rapporterna.

---

## 5. `on_my_way`

Tabell och funktioner: `supabase/migrations/20261111040000_on_my_way.sql` (fanns inte i produktionen före 2026-11-11, så
"N på väg" hade aldrig visats). En rad per `user_id`, giltig till beräknad ankomst + 15 min (gångtiden högst 60 min).
`delete_my_data` raderar den också.

---

## ~~6. `increment_points` — en RPC som inte finns~~ — åtgärdat

`submitReport` och `queueSessionEntered` anropade `supabase.rpc('increment_points', …)`, en funktion
som inte finns i databasen. Felet var tyst (returvärdet kontrollerades inte) och poängen beräknas
ändå i klienten. Anropen är borttagna; appen anropar inte längre någon poäng-RPC.

---

## 7. Klientens lagring (`localStorage`)

| Nyckel | Innehåll | Konsekvens om den försvinner |
|---|---|---|
| `qb_user_id` | `'user-<tid>-<slump>'`, skapas vid första besöket | **All historik, alla poäng och all raderingsmöjlighet tappas permanent** |
| `qb_queue_session` | Aktiv kö-session: id, ställe, senaste antal, antal uppföljningar | Sessionen kan inte följas upp eller avslutas |
| `qb_on_my_way` | Aktivt "På väg"-läge | Bannern försvinner, servern har kvar posten tills den löper ut |
| `qb_favorites` | Array med venue-id | Favoriterna försvinner (de läses inte från databasen) |
| `qb_testdata` | `'1'` = testdata på (Alt + 2) | — |
| `qb_consent` | `'true'` när informationsrutan bekräftats ("Jag förstår"); inget annat värde sätts | Informationsrutan visas igen |
| `qb_install_dismissed` | PWA-prompten avvisad | — |
| `qb_push` | `'1'` = notiser påslagna här | Profilen visar "Av"; prenumerationen finns kvar tills den slås på igen |
| `qb_push_dismissed` | Rutan "Få notiser" efter en ny favorit stängd med × | — |

---

## 8. Säkerhet och behörigheter

### Verifierat i produktionen 2026-11-11

1. **`user_id` sätts av klienten** och är hemligt: anon får läsa alla kolumner i `reports` utom `user_id`
   (`supabase/migrations/20261111030000_hide_user_id.sql`, körd 2026-11-11 efter att klienten driftsatts). De gamla
   "user-…"-id:na, som var läsbara, byttes på servern mot nya som ingen känner till; klienten byter själv ut ett
   "user-…"-id (`getUserId`).
2. **Spärren mot dubbelrapportering finns på servern** (`reports_guard`, per `user_id`). Den som rensar
   `localStorage` får ett nytt id och är fri igen; det finns inget konto att spärra.
3. **`expires_at` och `created_at` sätts av servern.**
4. **`queue_status` beräknas i klienten** och skickas med. Den kan sättas till vilket känt värde som helst
   oberoende av `people_ahead`.
5. **Radera min data** är ett anrop: `delete_my_data(p_user_id)` (security definer) raderar dina rader i `reports` och
   `push_subscriptions`. Bara vid svar utan fel rensas `localStorage`. Låst fast av "5. Radera min data" i
   `e2e/app.spec.js`. Förut stoppade `stop_on_my_way` (som inte finns) och den saknade delete-policyn varje radering.

6. **Nycklar i klartext i källkoden** (`src/main.js`): Mapbox-token, Supabase-URL och
   Supabase anon-nyckel. Båda är avsedda att vara publika — Mapbox-token är URL-begränsad och
   anon-nyckeln skyddas av RLS (punkt 1–5 och migreringarna i `supabase/migrations/`). Ingen `.env` finns och ingen
   `import.meta.env` läses, trots att Vite stöder det.

### XSS

Stängd för databastext, men beroendet är indirekt och värt att skydda:

| Fält | Skydd |
|---|---|
| `comment` | `escapeHtml()`  |
| `venue_name` | `escapeHtml()` |
| `venue_id` | **Inget escapande.** Säkert bara därför att `loadReports` filtrerar bort okända venue_id, så värdet alltid är ett av de kända i `VENUES` (bara `[a-z0-9-]`, låst av test). Tas filtret bort öppnas en injektionsväg via `onclick`-attributet. |
| `user_id` | Renderas aldrig, och kan inte läsas |

### Vad som inte kunnat verifieras

- `create table` för `reports`, `favorites`, `user_profiles` och `report_votes` (finns bara i produktionen)
- Index
