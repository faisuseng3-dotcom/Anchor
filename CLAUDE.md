# QueueBar — Claude Project Memory

## Vad projektet är

Mobil webbapp som visar köstatus och uppskattad väntetid för **28 barer och nattklubbar** i
Stockholms innerstad. All data kommer från användarnas egna rapporter — det finns ingen extern
datakälla för kölängder.

Den svåraste uppgiften i projektet är att omvandla enstaka opålitliga människorapporter till en
siffra som går att lita på klockan 23:00. Allt annat är underordnat det.

Produktion: `anchor-queuebar.vercel.app` (använd **aldrig** en Vercel-URL med slumpkod i mitten —
de är frysta ögonblicksbilder).

## Teknisk stack (verifierad 2026-10-18)

| | |
|---|---|
| Bygge | **Vite 6**, inget ramverk, ingen TypeScript |
| Kod | `src/main.js` (3 297 rader), `src/style.css` (1 443 rader), `index.html` (291 rader) |
| Karta | `mapbox-gl` 3.x **via npm**, stil `dark-v11`, centrum `[18.0686, 59.3293]` |
| Data | Supabase (PostgREST + Realtime) via `@supabase/supabase-js` 2.x |
| Typsnitt | **Satoshi** (Fontshare) för text, **Geist Mono** för siffror |
| Hosting | Vercel |
| Utvecklingsverktyg | `@frontman-ai/vite` (endast dev) |

`QueueBar/` i repot är ett **separat, ofullständigt Expo-projekt** — 22 ställen i stället för 28
och ingen väntetidsmodell. Det är inte produktion och delar ingen kod. Rör det inte om uppgiften
handlar om webbappen.

## Arkitektur i korthet

Allt ligger i **en fil**: `src/main.js`. Dela inte upp den utan att fråga först.

```
index.html  →  <script type="module" src="/src/main.js">
               ↓
VENUES (28 hårdkodade objekt)  +  allReports (från Supabase)
               ↓
estimateWait()  →  formatWait()  →  venueWaitText()
               ↓
karta · Utforska · Live · venue-kort   (alla via samma funktion)
```

**Skärmar:** `#screen-home` (karta), `#screen-explore` (lista), `#screen-live` (flöde),
`#screen-report` (tre steg), `#screen-profile`. Växlas av `showScreen()` — ingen router, URL:en
ändras inte.

**Kritiskt:** HTML byggs som strängar med inline `onclick`. ES-moduler har inget globalt scope, så
varje funktion som används i en `onclick` **måste** läggas till i `Object.assign(window, {...})`
längst ned i `src/main.js:3247`. Annars kastar klicket `ReferenceError`.

## Var logiken finns

| Vad | Var |
|---|---|
| **Väntetidsmodellen** | `src/main.js:226–430` — `estimateWait`, `sessionRates`, `formatWait`, `waitToStatus`, `computeStatus` |
| Venue-data | `src/main.js:159–187` — `VENUES`, 28 objekt. **Inte i databasen** — ändring = deploy |
| Supabase-läsning | `loadReports()` `:1251` — de 100 senaste icke-utgångna rapporterna |
| Rapportering | `submitReport()` `:1409`, `submitSessionReport()` `:1483` |
| Historisk dörrtakt | `loadHistoricalRates()` `:1590`, `historicalRateFor()` `:285` |
| Kalibrering | `computeCalibration()` `:1619` — skriv `qbCalibration()` i konsolen |
| Karta och lager | `src/main.js:940–1195` |
| Sökning | `venueScore()` `:1985`, `venueSearch()` `:2021` |
| XSS-skydd | `escapeHtml()` `:423` |

### Den enda vägen till en väntetid

Varje väntetid på varje skärm går genom **`venueWaitText(venueId)`** (`:386`). Det finns ingen
annan väg och det ska förbli så. `getStatusLabel()` (`:406`) ger fasta strängar och är **bara**
reserv för gamla rapporter utan `people_ahead`.

## Kommandon

```bash
npm run dev                # Vite på http://localhost:5173
npm run dev + ?testdata=true   # med 48 testrapporter för 17 ställen
npm run build              # produktionsbygge till dist/
node scripts/check.js      # 57 strukturkontroller — MÅSTE passera före commit
```

Det finns **inga enhetstester, ingen linter och ingen CI.** `check.js` söker efter textsträngar i
koden — den kontrollerar att funktioner *finns*, aldrig att de *räknar rätt*. Se
[docs/TESTING.md](docs/TESTING.md).

**Testdata:** `?testdata=true` i URL:en, eller **Alt + 2** (Option + 2 på Mac; ignoreras i
textfält där det skriver "@"). Växlar `qb_testdata` i localStorage och laddar om. Av som standard —
produktionen visar aldrig falska rapporter. **Verifiera alltid med testdata innan arbete
rapporteras klart.**

## Produkttänkande (gäller alla uppgifter)

QueueBar används klockan 23:00, i dåligt ljus, under social press. Tillämpa fintechs precision och
ärlighet på den situationen — men få det inte att se ut som en bankapp.

Agera som en självständig produktdesigner. Ifrågasätt svaga förslag, bilda en egen uppfattning,
laga rätt sak. Ladda **`/fintech-product-thinking`** för hela ramverket.

- Varje siffra på skärmen kommer från verklig data — aldrig en platshållare
- Kommunicera osäkerhet ärligt: "~15 min", inte "15 min". Gammal data ska **se** gammal ut
- Det viktigaste (köstatus, väntetid) har alltid mest visuell tyngd
- Läsbart på armlängds avstånd i svag belysning — minst 13 px brödtext, hög kontrast
- Tillstånden ska vara kompletta: tom, gammal, fel — dölj aldrig att data saknas
- Ifrågasätt redundans innan du lägger till något nytt

## Designprinciper (ej förhandlingsbara)

1. **DATA FÖRST** — verkliga siffror, aldrig platshållare
2. **HIERARKI I ALLT** — viktigast info får mest visuell tyngd
3. **SIFFROR ÄR KUNG** — mätvärden 22 px+/700, etiketter 10–12 px
4. **KONSISTENS** — matcha befintliga mönster innan du hittar på nya
5. **REDUNDANS ÄR FÖRBJUDEN** — visar två element samma sak, ta bort ett
6. **BORDER INTE SKUGGA** — `1px solid rgba(255,255,255,0.09)`, `border-color` vid hover,
   ingen `box-shadow` på kort

Fullständigt designsystem: **`/premium-design`**.

## Färger (verifierade i koden)

Definierade som CSS-variabler i `src/style.css:` `--status-*`, och i JS i `getStatusColor()`
(`src/main.js:410`).

| Status | Hex | Betyder |
|---|---|---|
| `none` / free | `#34E07F` | ingen kö |
| `short` | `#FFD23F` | under 18 min |
| `medium` | `#FF8A3D` | 18–30 min |
| `long` | `#FF4D5E` | över 30 min, eller "Fullt" |
| `unknown` | `#7C8194` | ingen data |

⚠️ **Känt problem:** status­färgerna är definierade på **fyra** ställen — CSS `--status-*`,
`getStatusColor()` (`:410`), `STATUS_COLORS` (`:1247`) och `heroColors` (`:2295`). De är inte
synkroniserade: `getStatusColor('unknown')` ger `#7C8194` medan `STATUS_COLORS.unknown` ger
`#4A4F60`. Lägg inte till en femte källa. Använd `getStatusColor()`.

## Viktiga CSS-klasser

- `.erow` — venue-rad i Utforska · `.erow--empty` — ingen data · `.erow--long/--free` — nivå
- `.erow-pulse-dot` — blinkande röd punkt vid lång kö
- `.exsum` — widgeten "Stockholm just nu"
- `.venue-group` — grupperad container med `1px solid rgba(255,255,255,0.09)`
- `.qs-*` — kö-sessionsbanner · `.tl-*` — Live-flödets rader
- `.toast` — texten **måste** vara `var(--bg-primary)`, bakgrunden är `--text-primary`

## Ingenjörsprinciper

- **Förstå innan du ändrar** — följ dataflödet, läs koden, kör `check.js` först
- **Enklast tillförlitliga lösning** — förklarlig determinism framför smarta abstraktioner
- **Verifierat, inte antaget** — skilj det du testat från det du tror
- **Säkerhet är lagrad** — klientvalidering är UX, serverns RLS är den verkliga gränsen
- **Osäkerhet är ärlighet** — gammal data ska se gammal ut, saknad data ska sägas, hitta aldrig på
- **Bevis framför intuition** — observera, formulera hypotes, gör minsta ändring, inspektera

Fullständig metodik: **`/first-principles-engineering`**.

Anpassa djupet till risken: en CSS-justering behöver ingen revision. En ändring i
aggregeringen eller säkerheten gör det.

## Regler för avgränsad implementation

- **Ändra inte väntetidsmodellen** (`:226–430`) utan att det är uppgiften. Den är appens kärna.
- **Bygg inte om fungerande delar** för att en annan arkitektur vore finare.
- **Dela inte upp `src/main.js`** utan att fråga.
- **Rör inte `VENUES`** om uppgiften inte uttryckligen handlar om venue-data.
- **En ändring i taget**, aldrig parallella redigeringar i samma fil. `src/main.js` har trunkerats
  två gånger av parallella AI-redigeringar. Ange radantal före och efter.
- **Lägg till nya `onclick`-funktioner i `Object.assign(window, …)`** — annars går de sönder tyst.
- **Skriv aldrig om en hel fil.** Kirurgiska ändringar.
- Skilj alltid **befintliga problem** från problem din ändring orsakade.

## Säkerhet

**Committa aldrig `.env`** — ligger i `.gitignore`. Just nu finns ingen `.env`: Mapbox-token,
Supabase-URL och anon-nyckel ligger i klartext i `src/main.js:62, 66–67`. Det är avsiktligt och
säkert **förutsatt** att RLS är korrekt satt i databasen — vilket inte kunnat verifieras. Se
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) avsnitt 8.

All text från databasen **måste** gå genom `escapeHtml()` innan den hamnar i en HTML-sträng.
`venue_id` skrivs oescapat i `onclick` och är säkert **bara** tack vare filtret i `loadReports`
(`:1277`) — ta inte bort det filtret.

## Commit-konvention

```
Kort imperativ titel

Brödtext som förklarar vad och varför (inte hur).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MPy84B9aXUBmuBJs5cHVmD
```

Kör `node scripts/check.js` före varje commit. Alla kontroller måste passera.

## Mönster från tidigare sessioner

- `animation-fill-mode: forwards` krävs för keyframes som sätter ett sluttillstånd
- `@keyframes rowInEmpty` kodar `opacity: 0.55` i `to` — sätt aldrig opacity direkt på `.erow--empty`
- Tomma kort **måste** sorteras sist — använd alltid `localeCompare(b.name, 'sv')`
- `STATUS_RANK`: `{free: 0, none: 0, short: 1, medium: 2, long: 3}` — för trendberäkning
- `computeExploreSummary()` använder 30 min färskhetsgräns och 2 timmars fönster
- `_exsumFirstRender` styr countUp — animerar bara vid första renderingen
- Pulsanimation: ta bort klassen → tvinga reflow (`void el.offsetWidth`) → lägg tillbaka
- Väntetid är aldrig en fast sträng per status — alltid `venueWaitText()`
- Bara `report_type: 'initial'` mäter kölängd (`isQueueReport`); `followup` är positioner i kön
- "Fullt" kräver ≥2 mätta sessioner — härled det aldrig ur `venue.pace`
- Kö-session i localStorage `qb_queue_session`; uppföljningar behöver ≥4 min mellanrum (server: 3)
- "På väg" i localStorage `qb_on_my_way`; efter ankomst frågar bannern om rapport i 30 min
- "På väg"-antal kommer från RPC `on_my_way_counts()` (≥3, serverside); klienten döljer också <3
- `forecastWait()` visas bara med ≥3 initial-rapporter på 30 min över ≥10 min
- Taktlager i `estimateWait`: ikväll → `_historicalRates` (samma veckodag ±1 h, ≥3) → `venue.pace`.
  Priorn väger som 2 sessioner, så den är **trög** — med 3 mätningar väger den fortfarande 40 %
- `qbCalibration()` i konsolen: medianfel, bias (+ = appen lovade för kort väntan), andel i intervall

## Känd skuld

Dokumenterad i [docs/](docs/). De allvarligaste:

1. **Databasschemat är inte versionshanterat** — ingen SQL i repot, RLS går inte att granska
2. **Serverfel visas som "inga rapporter"** i widgeten "Stockholm just nu" och i Live-flödet
3. **Väntetidsmodellen har inga tester** — `check.js` kan inte upptäcka ett räknefel
4. `deleteAllUserData()` kontrollerar inget returvärde — radering kan misslyckas tyst
5. `increment_points`-RPC:n finns inte; poäng beräknas i klienten
6. Tio venue-par ligger under 60 m från varandra, ett par på 3 m — kartnålar överlappar
7. Död kod: `computeConfidence`, `toggleWatch`, `renderVenueCard`, `renderSparkline`, `formatAbsTime`
8. `map.on('error')` nollar kartan permanent vid **vilket** fel som helst, även ett tappat tile-anrop

## Vidare läsning

| Dokument | Innehåll |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Systemstruktur, dataflöde, beroenden, flaskhalsar |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Tabeller, fält, localStorage, säkerhet och behörigheter |
| [docs/QUEUE_LOGIC.md](docs/QUEUE_LOGIC.md) | Köberäkningen i detalj, med verifierade räkneexempel |
| [docs/TESTING.md](docs/TESTING.md) | Vad som testas, vad som inte gör det, hur man verifierar |
