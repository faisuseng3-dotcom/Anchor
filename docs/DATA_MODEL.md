# QueueBar — Datamodell

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).

> ## ⚠️ Viktig förutsättning för hela dokumentet
>
> **Repot innehåller ingen schemadefinition.** Det finns ingen SQL-fil, inga migrationer och ingen
> typdefinition. Tabellerna, kolumntyperna, RLS-policyerna, triggrarna och RPC-funktionerna finns
> **enbart** i Supabase-projektets webbgränssnitt.
>
> Allt nedan är **härlett ur anropen i `src/main.js`** — alltså vilka kolumner appen skriver och
> läser. Det säger inget om vilka kolumner som faktiskt finns, vilka typer de har, vilka
> begränsningar som gäller eller hur RLS är konfigurerat.
>
> Rader markerade **OVERIFIERAT** kan inte bekräftas utan åtkomst till Supabase-projektet.
> Att göra schemat versionshanterat är rekommendation F-01 i granskningen.

Inga nycklar, lösenord eller produktionsdata återges i detta dokument. Supabase-URL och den publika
anon-nyckeln ligger i klartext i `src/main.js`; se säkerhetsavsnittet längst ned.

---

## 1. `VENUES` — ställena

**Ställena ligger inte i databasen.** De är en hårdkodad array på 28 objekt i
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
| `closing` | string `HH:MM` | `'05:00'` | `closingHour()` / `minutesToClose()` → "Bäst nu", "hinner du". |
| `pace` | `'slow'` \| `'normal'` \| `'fast'` | `'slow'` | **Startgissning för dörrtakt** innan mätningar finns. Se [QUEUE_LOGIC.md](QUEUE_LOGIC.md). |

Alla 28 objekt har samtliga nio fält (verifierat). `pace` fördelar sig `fast: 14`, `normal: 9`,
`slow: 5`.

### Verifierade problem i venue-datan

- **`sturecompagniet` och `hells-kitchen` ligger 3 m från varandra** och delar adressen
  "Sturegatan 4". På kartan ritas de ovanpå varandra; en av dem går inte att träffa med fingret.
- **Tio par ligger närmare än 60 m** från varandra: fem av dem runt Stureplan
  (`sturehof`, `spy-bar`, `sturecompagniet`, `drama`, `hells-kitchen`).
- `akkurat` (Hornsgatan 18) och `patricia` (Stadsgårdskajen 152) beräknas ligga 57 m från varandra,
  vilket inte stämmer med adresserna — minst en av koordinaterna är fel.
- `data/venues_candidates.json` innehåller resultatet från en OpenStreetMap-körning som pekar ut
  13 avvikande koordinater och 3 ställen som inte kunde hittas. **Den datan används inte av appen.**

Det finns **ingen validering** av `VENUES` — inget schema, ingen dubblettkontroll, inget test.
`scripts/check.js` kontrollerar bara att 17 testdata-id:n finns och att varje objekt har `pace`.

---

## 2. `reports` — körapporterna

Den enda tabell appen både läser och skriver i stor omfattning.

### Kolumner appen använder

| Kolumn | Skrivs av klienten | Läses | Innehåll |
|---|---|---|---|
| `id` | nej | nej | **OVERIFIERAT** — antas primärnyckel satt av databasen |
| `created_at` | **nej** | ja, överallt | Sätts av databasens default. All färskhetslogik bygger på den. |
| `venue_id` | **ja** | ja | Matchar `VENUES[].id`. Hamnar i `onclick` — se XSS-noten nedan. |
| `venue_name` | **ja** | ja (reserv) | Denormaliserat namn. Escapas vid rendering. |
| `user_id` | **ja** | ja | **Klientgenererad sträng** från `localStorage.qb_user_id`. Se säkerhet. |
| `queue_status` | **ja** | ja | `'none'`\|`'short'`\|`'medium'`\|`'long'`. Beräknas i klienten med `waitToStatus()`. |
| `people_ahead` | **ja** | ja | Heltal: knappens **mittvärde** (0, 5, 17, 37 eller 60), inte ett exakt antal. |
| `report_type` | **ja** | ja | `'initial'` \| `'followup'` \| `'entered'`. Saknas på äldre rader → behandlas som `'initial'`. |
| `queue_session` | **ja** | ja | `'qs-<base36>-<slump>'`. Binder ihop en persons mätpunkter i samma kö. |
| `expires_at` | **ja** | ja (filter) | `created_at + 45 min`, satt av klienten. `loadReports` filtrerar på den. |
| `comment` | ja, om ifylld | ja | Max 80 tecken (klientsidan). **Escapas** vid rendering. |

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

Appen **varken skriver eller läser** `favorites` längre. Favoriter finns bara i
`localStorage.qb_favorites` (`src/main.js`, `toggleFavorite`). Det enda anropet som rör tabellen är
`delete` i `deleteAllUserData()`, som tar bort gamla rader från när appen skrev dit.
Konsekvens: favoriter följer inte med mellan enheter — det sägs också i integritetstexten.

**OVERIFIERAT:** tidigare observation i projektet var att tabellen har en RLS-policy med
`ALL = true`, alltså att vem som helst kan radera vem som helsts favoriter. Kan inte bekräftas
härifrån och bör kontrolleras.

---

## 4. `user_profiles`

Appen **rör den bara i `deleteAllUserData()`** (`src/main.js`): `delete().eq('user_id', userId)` och
en räkning av det som finns kvar efteråt. Den läses och skrivs aldrig i övrigt.

Poäng, nivå, streak och märken beräknas helt i klienten i `updateProfileStats()`
(`src/main.js`) ur antalet egna rapporter:

```
poäng = (antal initial-rapporter × 10) + (antal entered-rapporter × 5)
```

Det betyder att tabellen är **funktionellt oanvänd**. RPC-anropet `increment_points` är borttaget
(avsnitt 6). Se F-04 i granskningen.

---

## 5. `on_my_way`

Den enda tabell som hanteras korrekt ur säkerhetsperspektiv. Appen når den **aldrig direkt** — bara
genom tre security-definer-funktioner:

| RPC | Parametrar | Används av |
|---|---|---|
| `start_on_my_way` | `p_user_id`, `p_venue_id`, `p_minutes` | `goOnMyWay()` |
| `stop_on_my_way` | `p_user_id` | `cancelOnMyWay()` |
| `on_my_way_counts` | — | `loadOnMyWayCounts()` |

`on_my_way_counts()` returnerar enligt klientkoden bara ställen med minst 3 aktiva, och klienten
döljer dessutom allt under 3 (`onMyWayCount`). Dubbel spärr mot att avslöja att en enskild
person är på väg någonstans. **Det här är mönstret som bör användas för alla tabeller.**

**OVERIFIERAT:** att tabellen har RLS utan policyer, så att bara RPC-funktionerna kommer åt den.

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
| `qb_onboarding_done` | Introduktionen klar | Introduktionen visas igen |
| `qb_install_dismissed` | PWA-prompten avvisad | — |

---

## 8. Säkerhet och behörigheter

### Verifierat ur koden

1. **`user_id` sätts av klienten.** `getUserId()` läser eller skapar en sträng i
   `localStorage`. Den skickas med i varje `insert`. Servern kan därför inte skilja två användare
   åt, och ingen klient kan bevisa vem den är. **Detta är grundorsaken till punkterna 2–4.**

2. **Spärren mot dubbelrapportering är enbart klientsidan.** `submitReport` letar efter
   egna rapporter under 20 minuter i `allReports` — alltså i de **1000 senaste** inlästa raderna.
   Finns ens den egna rapporten inte där, släpper spärren igenom. Och den som rensar
   `localStorage` får ett nytt `user_id` och är fri igen.
   Felsträngarna `rate_limited` och `too_soon` i `reportErrorText` antyder att en
   serverspärr finns. **OVERIFIERAT.**

3. **`expires_at` sätts av klienten**. En manipulerad klient kan sätta den långt fram i
   tiden och få en rapport att överleva i Utforska, på kartan och i Live-flödet i princip för alltid.

4. **`queue_status` beräknas i klienten** och skickas med. Den kan sättas till vilket
   värde som helst oberoende av `people_ahead`.

5. **`select('*')` returnerar `user_id` till alla.** Varje besökare kan läsa samtliga `user_id`
   tillsammans med `venue_id` och `created_at` — alltså rekonstruera var en enskild person varit
   under en kväll, i vilken ordning. Fältet renderas aldrig i gränssnittet, men det ligger i svaret.

6. ~~**Radering kan misslyckas tyst.**~~ Åtgärdat. `deleteAllUserData()` raderar i alla tre tabeller
   och räknar sedan raderna kvar (`count: 'exact', head: true`) — en delete som RLS nekar ger
   inget fel, bara noll rader. Bara om alla tre visar `count === 0` rensas `localStorage`
   (och `qb_user_id`); annars en toast och id:t finns kvar så att användaren kan försöka igen.
   Låst fast av "5. Radera min data" i `e2e/app.spec.js`.

7. **Nycklar i klartext i källkoden** (`src/main.js`): Mapbox-token, Supabase-URL och
   Supabase anon-nyckel. Båda är avsedda att vara publika — Mapbox-token är URL-begränsad och
   anon-nyckeln skyddas av RLS. Det är **korrekt** så länge RLS verkligen är satt, vilket är
   det som inte kan verifieras. Ingen `.env` finns och ingen `import.meta.env` läses, trots att
   Vite stöder det.

### XSS

Stängd för databastext, men beroendet är indirekt och värt att skydda:

| Fält | Skydd |
|---|---|
| `comment` | `escapeHtml()`  |
| `venue_name` | `escapeHtml()` |
| `venue_id` | **Inget escapande.** Säkert bara därför att `loadReports` filtrerar bort okända venue_id, så värdet alltid är ett av 28 kända. Tas filtret bort öppnas en injektionsväg via `onclick`-attributet. |
| `user_id` | Renderas aldrig |

### Vad som inte kunnat verifieras

- Vilka RLS-policyer som faktiskt gäller för `reports`, `favorites`, `user_profiles`, `on_my_way`
- Om det finns serverside-triggrar som validerar `people_ahead`, `queue_status`, `expires_at`
- Om det finns en serverspärr mot dubbelrapportering
- Om `increment_points` finns (appen anropar den inte längre)
- Kolumntyper, NOT NULL, CHECK-begränsningar, index och främmande nycklar

Ett försök att hämta PostgREST:s OpenAPI-schema (som hade gett kolumner och typer utan att röra en
enda datarad) avvisades av utvecklingsmiljöns nätverkspolicy.
