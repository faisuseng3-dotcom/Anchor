# Qbar (tidigare QueueBar) — Claude Project Memory

## Vad projektet är

Mobil webbapp som visar köstatus och uppskattad väntetid för **28 barer och nattklubbar** i
Stockholms innerstad. All data kommer från användarnas egna rapporter — det finns ingen extern
datakälla för kölängder.

Den svåraste uppgiften i projektet är att omvandla enstaka opålitliga människorapporter till en
siffra som går att lita på klockan 23:00. Allt annat är underordnat det.

**Namnet är Qbar.** Allt användaren ser säger Qbar. Kvar som QueueBar: domänen `queuebar.se` (e-post),
Vercel-URL:en, `[QueueBar]`-prefixet i konsolloggar och mappen `QueueBar/` (Expo-projektet).

**Introt** (`#splash` + inline-skript i `index.html`, blocket "Intro" i `src/style.css`): Q:et visas stort medan
ringen fylls som en timer (en färg i taget, röd → gul → grön, stannar på 72 % — aldrig flera färger samtidigt, då
liknar den Googles logga), i hålet spelar en 3D-stad där gubben leds in i en gata, sedan krymper Q:et in i "Qbar",
~2,4 s. Stan
är klippet `public/splash-city.mp4` (490 kB, spelas i dubbel fart), renderat ur reklamprojektet med
`node scripts/render-splash.mjs` i `~/Desktop/qbar-ad` (kamera och gång i `renderSplashAt`). Spelar klippet inte
inom 0,9 s (långsamt nät, iOS strömsparläge, webbläsare utan H.264) krymper Q:et direkt, ~1,6 s. En gång per
session (`sessionStorage` `qb_splash`), hoppas över vid tryck, stilla logga vid `prefers-reduced-motion`.
E2E-testerna hoppar över det i `skipOnboarding`.

Produktion: `anchor-queuebar.vercel.app` (använd **aldrig** en Vercel-URL med slumpkod i mitten —
de är frysta ögonblicksbilder).

## Teknisk stack (verifierad 2026-10-18)

| | |
|---|---|
| Bygge | **Vite 6**, inget ramverk, ingen TypeScript |
| Kod | `src/main.js` (3 139 rader), `src/style.css` (1 370 rader), `index.html` (273 rader) |
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
längst ned i `src/main.js`. Annars kastar klicket `ReferenceError`.

## Var logiken finns

Sök på funktionsnamnet — **inte på radnummer.** Dokumentationen innehöll tidigare radnummer och de
blev felaktiga inom ett dygn när en commit tog bort 158 rader. Använd
`grep -n "function estimateWait" src/main.js`.

| Vad | Funktioner |
|---|---|
| **Väntetidsmodellen** | `estimateWait`, `sessionRates`, `measureQueueRates`, `setWaitRange`, `formatWait`, `waitToStatus`, `computeStatus`, `historicalRateFor`, `forecastWait`, `aheadBucket`, `median` — ett sammanhängande block mellan `PACE_RATE` och `getStatusLabel` |
| Venue-data | `VENUES` — 28 objekt. **Inte i databasen** — ändring = deploy |
| Supabase-läsning | `loadReports` — de 100 senaste icke-utgångna rapporterna |
| Rapportering | `submitReport`, `submitSessionReport`, `submitQueueFollowup`, `queueSessionEntered` |
| Historisk dörrtakt | `loadHistoricalRates`, `historicalRateFor`, `nightKey` |
| Kalibrering | `computeCalibration` — skriv `qbCalibration()` i konsolen |
| Karta och lager | mellan `showMapError` och `getUserId`: `registerTypePins`, `addTypePin`, `updateMapStatuses` |
| Utforska-summering | `computeExploreSummary`, `exsumText`, `renderExploreSummary` |
| Sökning | `venueScore`, `venueSearch`, `_searchNorm` |
| XSS-skydd | `escapeHtml` — fyra anropsställen |

### Den enda vägen till en väntetid

Varje väntetid på varje skärm går genom **`venueWaitText(venueId)`**. Det finns ingen
annan väg och det ska förbli så. `getStatusLabel()` ger fasta strängar och är **bara**
reserv för gamla rapporter utan `people_ahead`.

## Kommandon

```bash
npm run verify             # tester + kontroller + bygge — körs automatiskt före varje commit
npm test                   # 120 enhetstester (Vitest)
npm run test:watch         # kör om vid varje sparning
npm run e2e                # 10 webbläsartester (Playwright) — kräver en webbläsare, se nedan
npm run dev                # Vite på http://localhost:5173
npm run dev + ?testdata=true   # med 48 testrapporter för 17 ställen
```

`npm run verify` är `vitest run && node scripts/check.js && vite build`. Kör det, inte delarna var
för sig.

**Spärren före commit kör `npm run verify` automatiskt** (husky, `.husky/pre-commit`). Den sätts upp
av `npm install` — du behöver inte göra något. Tar ~15 sekunder. `--no-verify` hoppar över den; gör
det bara när du vet varför.

**CI** kör samma kedja plus E2E vid varje push (`.github/workflows/verify.yml`). Det är den enda
kontrollen som inte går att hoppa över.

**E2E-testerna ingår inte i `verify`** eftersom de kräver en webbläsarbinär. Första gången:

```bash
npx playwright install chromium
```

De tre kontrollerna gör olika saker och ersätter inte varandra:

- **`vitest`** testar att de rena funktionerna **räknar rätt**. Täcker väntetidsmodellen,
  kö-sessionerna, historiken, sökningen, `VENUES`-integriteten och inläsningslägena. Testerna läser
  funktionerna ur `src/main.js` via `tests/harness.js` — **ingen kod har flyttats för att möjliggöra
  dem.**
- **`check.js`** söker efter textsträngar och kontrollerar att funktioner och konventioner
  **finns**. Den upptäcker att något raderats, aldrig att något räknar fel. Den första kontrollen
  i filen letar efter **git-difftext incheckad som källkod** — se nedan.
- **`playwright`** kör appen i en riktig webbläsare på 390×844 med mockad Supabase. Täcker det som
  bara syns i DOM: att listan renderar, att feltillstånden ser olika ut, att sök och venue-kort
  fungerar, och att en rapport skickas med rätt fält.

**Ingen linter finns.** ESLint på en 3 187-radersfil i ES5-stil skulle ge hundratals varningar och
kräva konfigurationsbeslut som ingen tagit. Det är medvetet uppskjutet, inte förbisett.

Se [docs/TESTING.md](docs/TESTING.md).

## Difftext får aldrig checkas in som källkod

Den 19 oktober ersattes alla 3 198 rader i `src/main.js` med **patch-texten** som skulle appliceras
på filen. Filen blev en 47-radig unified diff, `vite build` dog på rad 1, och Vercels
produktionsdeploy fallerade. Rollup läste `--- a/src/main.js` som en dekrementoperator.

Första kontrollen i `scripts/check.js` letar nu efter fyra signaturer i alla `.js`, `.mjs`, `.cjs`,
`.css`, `.html` och `.json` under repot:

```
diff --git a/…          "---" följt av "+++" på nästa rad
@@ …                    index <sha>..<sha>
```

`.md` och `.yml` skannas **inte** — `---` är en vågrät linje i Markdown och en dokumentavgränsare i
YAML, så de skulle ge falska träffar.

`vite build` fångar också felet, men först när något kör bygget, och svarar med en rollup-stacktrace.
Den här kontrollen är billigare, namnger filen och signalen, och täcker varje källfil i stället för
bara de som nås från ingångspunkten.

**Fem tester i `tests/sessions.test.js`** skyddar mot att "Ingen kö" åter blir en uppmätt dörrtakt
på noll. Fallerar något av dem är vakten `aheadBucket(first.people_ahead).width > 0` borta.
**Nio tester i `tests/loadstate.test.js`** plus tre i `e2e/app.spec.js` skyddar mot att ett
serverfel åter ser ut som en tyst kväll.

## Fyra inläsningslägen — de får aldrig slås samman

`_loadState` är `'loading' | 'ok' | 'error'` och sätts i `loadReports`. Utan den kan en tom vy inte
skilja "inga rapporter i Stockholm" från "vi nådde inte servern", och då blir ett serverfel en lugn
kväll. Verifierat i webbläsare:

| Läge | Färskhetsraden | Live-flödets underrad | Rader |
|---|---|---|---|
| Tom databas | "Inga rapporter än — bli först att rapportera" | "Inga rapporter senaste 45 min" | 28 |
| **Fel, ingen data** | "Ingen kontakt med servern" + röd prick | "Ingen kontakt" | 0, felläge |
| **Fel, data kvar** | "Ingen kontakt med servern · siffrorna kan vara gamla" + prick | "Ingen kontakt · kan vara gammalt" | 28 **behållna** |
| Normalt | "17 av 28 ställen har färsk rapport · senast 3 min sedan" | "17 ställen · 45 min" | 28 |

Två regler som följer av det:

- **`exsumText(d, state)` tar tillståndet som argument, inte från en global.** Det är därför den är
  ren och testbar utan DOM. Görs den om till att läsa `_loadState` direkt försvinner testerna.
- **`renderLoadFailure()` kastar inte bort data som redan finns.** Att tömma en fungerande lista
  för att en enda pollning missade är sämre än att visa den med en varning. `showExploreError()`
  körs bara när `allReports` är tom.

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
(`src/main.js`).

| Status | Hex | Betyder |
|---|---|---|
| `none` / free | `#34E07F` | ingen kö |
| `short` | `#FFD23F` | under 18 min |
| `medium` | `#FF8A3D` | 18–30 min |
| `long` | `#FF4D5E` | över 30 min, eller "Fullt" |
| `unknown` | två värden — se nedan | ingen data |

⚠️ **Känt problem:** status­färgerna är definierade på **fyra** ställen — CSS `--status-*`,
`getStatusColor()`, `STATUS_COLORS` och `heroColors`.

Den neutrala paletten synkroniserade `free`, `short`, `medium` och `long` över alla fyra. **`unknown`
är fortfarande osynkroniserad**, verifierat på HEAD `28040f2`:

| Källa | `unknown` |
|---|---|
| `getStatusColor('unknown')` och `heroColors`-fallback | `#85858A` |
| `STATUS_COLORS.unknown` och CSS `--status-unknown` | `#55555B` |

`renderExploreVenueRow` använder `STATUS_COLORS[cls] || getStatusColor('unknown')`, så raden kan få
antingen värdet beroende på väg. Lägg inte till en femte källa. Använd `getStatusColor()`.

## Viktiga CSS-klasser

- `.erow` — venue-rad i Utforska · `.erow--empty` — ingen data · `.erow--long/--free` — nivå
- `.erow-pulse-dot` — blinkande röd punkt vid lång kö
- `.exsum-line` — färskhetsraden i Utforska ("17 av 28 ställen har färsk rapport · senast 3 min sedan")
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

- **Ändra inte väntetidsmodellen** (blocket från `PACE_RATE` till `getStatusLabel`) utan att det är
  uppgiften. Den är appens kärna.
- **Bygg inte om fungerande delar** för att en annan arkitektur vore finare.
- **Dela inte upp `src/main.js`** utan att fråga.
- **Rör inte `VENUES`** om uppgiften inte uttryckligen handlar om venue-data.
- **En ändring i taget**, aldrig parallella redigeringar i samma fil. `src/main.js` har trunkerats
  två gånger av parallella AI-redigeringar. Ange radantal före och efter.
- **Lägg till nya `onclick`-funktioner i `Object.assign(window, …)`** — annars går de sönder tyst.
- **Skriv aldrig om en hel fil.** Kirurgiska ändringar.
- **Läs filen efter varje mönsterbaserad ändring** (`sed`, `perl`, `awk`, sök-och-ersätt). Ett
  mönster som matchar fel ändrar inte en rad utan alla, och det syns inte i utdata. En
  `perl`-ersättning avsedd för en rad i `CLAUDE.md` sprutade in sig före alla 256 raderna och
  tredubblade filen — `npm run verify` var grönt hela tiden, för ett testsvit verifierar inte en
  Markdown-fil. Föredra exakta redigeringar framför regex när träffarna är få.
- **Verifiera det du faktiskt ändrade**, inte bara att något annat fortfarande fungerar. Gröna
  tester är inget bevis för att den redigerade filen är hel.
- Skilj alltid **befintliga problem** från problem din ändring orsakade.

## Säkerhet

**Committa aldrig `.env`** — ligger i `.gitignore`. Just nu finns ingen `.env`: Mapbox-token,
Supabase-URL och anon-nyckel ligger i klartext i `src/main.js`. Det är avsiktligt och
säkert **förutsatt** att RLS är korrekt satt i databasen — vilket inte kunnat verifieras. Se
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) avsnitt 8.

All text från databasen **måste** gå genom `escapeHtml()` innan den hamnar i en HTML-sträng.
`venue_id` skrivs oescapat i `onclick` och är säkert **bara** tack vare filtret i `loadReports`
som släpper igenom enbart kända venue_id — ta inte bort det filtret.

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
- Färskhetsraden ersatte den gamla "Stockholm just nu"-widgeten med räknare per status. Antalen
  finns redan i filterchipsen, så raden visar bara det chipsen inte säger — hur färsk datan är.
  Lägg inte tillbaka räknarna; det är redundans (princip 5)
- `venueFreshStatus()` använder 45 min som färskhetsgräns, samma som `estimateWait`
- `computeExploreSummary()` returnerar `{fresh, venueTotal, lastTs, total}`; `exsumText()` formaterar
- `renderExploreSummary()` sätter om sitt 30-sekundersintervall vid varje rendering, så raden
  åldras även utan ny data
- Pulsanimation: ta bort klassen → tvinga reflow (`void el.offsetWidth`) → lägg tillbaka
- Väntetid är aldrig en fast sträng per status — alltid `venueWaitText()`
- Kartkluster är mörka med färgad ring (värsta status) och vit siffra. Siffran är antal ställen — i en färgad boll
  lästes den som minuter. Visa aldrig en väntetid i klustret; den enda vägen till en väntetid är `venueWaitText()`
- Grundkartan (`MAP_THEME`) är dämpad: grå vägar, dov park, mörkt vatten. Statusfärgerna ska vara det enda som lyser;
  röd ska ha ≥3,5:1 mot allt den kan ligga på
- Kartans lager uppifrån: nålar → namn (`venues-names`, från zoom 13,8, döljs vid krock — aldrig pillen) → kluster →
  du-är-här (`me-dot`/`me-halo`, accentblå) → statusglöd (`venues-glow`, under baskartans etiketter, bara färsk data).
  Startvyn ramar in alla 28 ställen mellan sökfältet och "Bäst nu"-kortet (`startCamera`)
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
2. `deleteAllUserData()` kontrollerar inget returvärde — radering kan misslyckas tyst
3. `increment_points`-RPC:n finns inte; poäng beräknas i klienten
4. Tio venue-par ligger under 60 m från varandra, ett par på 3 m — kartnålar överlappar.
   Låst fast av `KÄNT PROBLEM`-tester i `tests/venues.test.js`
5. Död kod: `computeConfidence`, `toggleWatch`, `renderVenueCard`, `renderSparkline`, `formatAbsTime`
6. `map.on('error')` nollar kartan permanent vid **vilket** fel som helst, även ett tappat tile-anrop
7. **Ingen linter.** Medvetet uppskjutet — se motiveringen under Kommandon
8. `limit(100)` i `loadReports` kan tysta hastighetsmätningen en full fredag (B-05 i
   [docs/QUEUE_LOGIC.md](docs/QUEUE_LOGIC.md))
9. Realtime och 30-sekunderspollningen körs samtidigt; varje `insert` får alla klienter att läsa om

**Åtgärdat:**

- `sessionRates` mätte takten 0 från en session som rapporterat "Ingen kö"
  (`aheadBucket(0).width` är 0). Två sådana sessioner fick appen att visa "Fullt" när kön började
  byggas. Löst med `&& aheadBucket(first.people_ahead).width > 0`, låst fast av fem tester i
  `tests/sessions.test.js`
- Serverfel visades som "inga rapporter". Löst med `_loadState` — se avsnittet nedan
- Modellen hade inga tester. 120 enhetstester + 10 E2E-tester finns nu
- Ingen spärr före commit och ingen CI. Båda finns nu: `.husky/pre-commit` och
  `.github/workflows/verify.yml`

## Vidare läsning

| Dokument | Innehåll |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Systemstruktur, dataflöde, beroenden, flaskhalsar |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Tabeller, fält, localStorage, säkerhet och behörigheter |
| [docs/QUEUE_LOGIC.md](docs/QUEUE_LOGIC.md) | Köberäkningen i detalj, med verifierade räkneexempel |
| [docs/TESTING.md](docs/TESTING.md) | Testerna, vad `check.js` bevisar och inte, buggen testerna hittade |
| `tests/harness.js` | Hur testerna läser modellen ur `src/main.js` utan att flytta kod |
