# QueueBar — Datamodell

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `395f59e`).

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
anon-nyckeln ligger i klartext i `src/main.js:66–67`; se säkerhetsavsnittet längst ned.

---

## 1. `VENUES` — ställena

**Ställena ligger inte i databasen.** De är en hårdkodad array på 28 objekt i
`src/main.js:159–187`. Att lägga till, ta bort eller flytta ett ställe är en **kodändring och en
deploy**, inte en databasuppdatering.

| Fält | Typ | Exempel | Används av |
|---|---|---|---|
| `id` | string, primärnyckel | `'spy-bar'` | Kopplar rapporter till ställe. Hamnar i `onclick`-attribut. |
| `name` | string | `'Spy Bar'` | Visas överallt. Behandlas som betrodd (ej escapad). |
| `address` | string | `'Birger Jarlsgatan 20'` | Visas i venue-kort, sökbart (poäng 20). |
| `area` | string | `'Östermalm'` | Visas, sökbart (poäng 30–40), gruppering. |
| `type` | `'bar'` \| `'klubb'` | `'klubb'` | Filter i Utforska, väljer kartikon (glas/not). |
| `lat`, `lng` | number | `59.3360, 18.0730` | Kartnål, avståndsberäkning, kvällsplan. |
| `closing` | string `HH:MM` | `'05:00'` | `closingHour()` → kvällsplan, "hinner du". |
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
användaren tryckte på (`AHEAD_BUCKETS`, `src/main.js:217`):

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
initial    Mäter kölängden. Startar en queue_session. Enda typen som räknas som en
           kömätning (isQueueReport). Ger 10 poäng.
followup   "Står du kvar?" — en ny position i SAMMA kö. Mäter hur snabbt kön rör sig.
           Räknas INTE som en kömätning. Minst 4 min mellan varje, max 4 stycken.
entered    "Jag är inne" — people_ahead = 0. Avslutar sessionen, ger den verkliga
           väntetiden och används för kalibrering. Ger 5 poäng.
```

### Läsfrågor

| Funktion | Fråga | Gräns |
|---|---|---|
| `loadReports` (`:1272`) | `select * where expires_at >= nu order by created_at desc` | **limit 100** |
| `loadHistoricalPatterns` (`:1557`) | `select venue_id, queue_status, created_at where created_at >= 8 v, queue_status != 'none', report_type = 'initial'` | ingen → PostgREST-default 1000, **osorterat** |
| `loadHistoricalRates` (`:1592`) | `select venue_id, queue_session, people_ahead, report_type, created_at where queue_session not null, created_at >= 8 v order by created_at desc` | **limit 1000** |
| `loadUserHistory` (`:3221`) | `select * where user_id = mitt` | ingen |

---

## 3. `favorites`

| Kolumn | Skrivs | Läses |
|---|---|---|
| `user_id` | ja | nej |
| `venue_id` | ja | nej |

Appen **läser aldrig** från `favorites`. Favoriter visas från `localStorage.qb_favorites`
(`src/main.js:1686`). Tabellen får `insert` och `delete` (`:1681, :1684`) men värdet används inte.
Konsekvens: favoriter följer inte med mellan enheter, och tabellen fyller ingen funktion i appen
idag.

**OVERIFIERAT:** tidigare observation i projektet var att tabellen har en RLS-policy med
`ALL = true`, alltså att vem som helst kan radera vem som helsts favoriter. Kan inte bekräftas
härifrån och bör kontrolleras.

---

## 4. `user_profiles`

Appen **rör den bara på ett enda ställe**: `delete().eq('user_id', userId)` i `deleteAllUserData()`
(`src/main.js:1955`). Den läses aldrig och skrivs aldrig i övrigt.

Poäng, nivå, streak och märken beräknas helt i klienten i `updateProfileStats()`
(`src/main.js:3150`) ur antalet egna rapporter:

```
poäng = (antal initial-rapporter × 10) + (antal entered-rapporter × 5)
```

Det betyder att tabellen är **funktionellt oanvänd** och att RPC-anropet `increment_points`
(`:1439, :1527`) är verkningslöst. Se F-04 i granskningen.

---

## 5. `on_my_way`

Den enda tabell som hanteras korrekt ur säkerhetsperspektiv. Appen når den **aldrig direkt** — bara
genom tre security-definer-funktioner:

| RPC | Parametrar | Används av |
|---|---|---|
| `start_on_my_way` | `p_user_id`, `p_venue_id`, `p_minutes` | `goOnMyWay()` (`:2882`) |
| `stop_on_my_way` | `p_user_id` | `cancelOnMyWay()` (`:2892`) |
| `on_my_way_counts` | — | `loadOnMyWayCounts()` (`:355`) |

`on_my_way_counts()` returnerar enligt klientkoden bara ställen med minst 3 aktiva, och klienten
döljer dessutom allt under 3 (`onMyWayCount`, `:361`). Dubbel spärr mot att avslöja att en enskild
person är på väg någonstans. **Det här är mönstret som bör användas för alla tabeller.**

**OVERIFIERAT:** att tabellen har RLS utan policyer, så att bara RPC-funktionerna kommer åt den.

---

## 6. `increment_points` — en RPC som inte finns

`submitReport` (`:1439`) och `queueSessionEntered` (`:1527`) anropar
`supabase.rpc('increment_points', …)`. Funktionen finns enligt tidigare observation inte i
databasen.

Supabase-klienten **kastar inte** vid RPC-fel — den returnerar `{ data, error }`. Returvärdet
kontrolleras inte på något av ställena. Felet är därför **helt tyst**. Eftersom poängen ändå
beräknas i klienten syns ingen skillnad för användaren; anropet är ett bortkastat nätverksanrop
per rapport och ett vilseledande spår i koden.

---

## 7. Klientens lagring (`localStorage`)

| Nyckel | Innehåll | Konsekvens om den försvinner |
|---|---|---|
| `qb_user_id` | `'user-<tid>-<slump>'`, skapas vid första besöket | **All historik, alla poäng och all raderingsmöjlighet tappas permanent** |
| `qb_queue_session` | Aktiv kö-session: id, ställe, senaste antal, antal uppföljningar | Sessionen kan inte följas upp eller avslutas |
| `qb_on_my_way` | Aktivt "På väg"-läge | Bannern försvinner, servern har kvar posten tills den löper ut |
| `qb_favorites` | Array med venue-id | Favoriterna försvinner (de läses inte från databasen) |
| `qb_testdata` | `'1'` = testdata på (Alt + 2) | — |
| `qb_consent` | Samtycke givet | Samtyckesmodalen visas igen |
| `qb_onboarding_done` | Introduktionen klar | Introduktionen visas igen |
| `qb_watched` | Bevakade ställen | — (funktionen är delvis död, se F-05) |
| `qb_install_dismissed` | PWA-prompten avvisad | — |

---

## 8. Säkerhet och behörigheter

### Verifierat ur koden

1. **`user_id` sätts av klienten.** `getUserId()` (`:1197`) läser eller skapar en sträng i
   `localStorage`. Den skickas med i varje `insert`. Servern kan därför inte skilja två användare
   åt, och ingen klient kan bevisa vem den är. **Detta är grundorsaken till punkterna 2–4.**

2. **Spärren mot dubbelrapportering är enbart klientsidan.** `submitReport` (`:1413`) letar efter
   egna rapporter under 20 minuter i `allReports` — alltså i de **100 senaste** inlästa raderna.
   Finns ens den egna rapporten inte där, släpper spärren igenom. Och den som rensar
   `localStorage` får ett nytt `user_id` och är fri igen.
   Felsträngarna `rate_limited` och `too_soon` i `reportErrorText` (`:1448`) antyder att en
   serverspärr finns. **OVERIFIERAT.**

3. **`expires_at` sätts av klienten** (`:1419`). En manipulerad klient kan sätta den långt fram i
   tiden och få en rapport att överleva i Utforska, på kartan och i Live-flödet i princip för alltid.

4. **`queue_status` beräknas i klienten** (`:1416`) och skickas med. Den kan sättas till vilket
   värde som helst oberoende av `people_ahead`.

5. **`select('*')` returnerar `user_id` till alla.** Varje besökare kan läsa samtliga `user_id`
   tillsammans med `venue_id` och `created_at` — alltså rekonstruera var en enskild person varit
   under en kväll, i vilken ordning. Fältet renderas aldrig i gränssnittet, men det ligger i svaret.

6. **Radering kan misslyckas tyst.** `deleteAllUserData()` (`:1949`) kör tre `delete` i en
   `Promise.all` och **kontrollerar inget returvärde**, varpå den kör `localStorage.clear()` och
   laddar om. Nekar RLS raderingen ser användaren ändå ett lyckat resultat — och eftersom
   `qb_user_id` just raderats kan hen aldrig försöka igen. Texten i gränssnittet säger
   "All din data raderas permanent" (`:3237`), vilket då inte är sant.

7. **Nycklar i klartext i källkoden** (`src/main.js:62, 66–67`): Mapbox-token, Supabase-URL och
   Supabase anon-nyckel. Båda är avsedda att vara publika — Mapbox-token är URL-begränsad och
   anon-nyckeln skyddas av RLS. Det är **korrekt** så länge RLS verkligen är satt, vilket är
   det som inte kan verifieras. Ingen `.env` finns och ingen `import.meta.env` läses, trots att
   Vite stöder det.

### XSS

Stängd för databastext, men beroendet är indirekt och värt att skydda:

| Fält | Skydd |
|---|---|
| `comment` | `escapeHtml()` (`:2367, :2743`) |
| `venue_name` | `escapeHtml()` (`:2742`) |
| `venue_id` | **Inget escapande.** Säkert bara därför att `loadReports` filtrerar bort okända venue_id (`:1277`), så värdet alltid är ett av 28 kända. Tas filtret bort öppnas en injektionsväg via `onclick`-attributet. |
| `user_id` | Renderas aldrig |

### Vad som inte kunnat verifieras

- Vilka RLS-policyer som faktiskt gäller för `reports`, `favorites`, `user_profiles`, `on_my_way`
- Om det finns serverside-triggrar som validerar `people_ahead`, `queue_status`, `expires_at`
- Om det finns en serverspärr mot dubbelrapportering
- Om `increment_points` finns
- Kolumntyper, NOT NULL, CHECK-begränsningar, index och främmande nycklar

Ett försök att hämta PostgREST:s OpenAPI-schema (som hade gett kolumner och typer utan att röra en
enda datarad) avvisades av utvecklingsmiljöns nätverkspolicy.
