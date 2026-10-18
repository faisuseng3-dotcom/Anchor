# QueueBar — Test och verifiering

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).

---

## 1. Vad som finns idag

| Verktyg | Finns | Kommando |
|---|---|---|
| **Vitest — 110 enhetstester** | ✅ | `npm test` |
| `scripts/check.js` — 53 strängkontroller | ✅ | `node scripts/check.js` |
| **Hela kedjan i ett kommando** | ✅ | `npm run verify` |
| Produktionsbygge | ✅ | `npm run build` |
| Utvecklingsserver | ✅ | `npm run dev` |
| E2E-tester / webbläsartester | ❌ | — |
| Linter | ❌ | — |
| Typkontroll | ❌ | — |
| CI (GitHub Actions eller liknande) | ❌ | — |
| Spärr före commit | ❌ | — |

```bash
npm run verify   # vitest run && node scripts/check.js && vite build
```

Kör det före varje commit. Senaste körning på HEAD `28040f2`:
**110 tester, 53 kontroller, bygget igenom.**

### Testfilerna

| Fil | Tester | Täcker |
|---|---|---|
| `tests/harness.js` | — | Läser de rena funktionerna ur `src/main.js` + testdatabyggare |
| `tests/wait.test.js` | 37 | `estimateWait`, `setWaitRange`, `formatWait`, `waitToStatus`, `aheadBucket`, `median` |
| `tests/sessions.test.js` | 23 | `sessionRates`, `measureQueueRates` — alla ogiltighetsregler |
| `tests/history.test.js` | 14 | `historicalRateFor`, `nightKey` |
| `tests/search.test.js` | 22 | `venueScore`, `venueSearch`, `_searchNorm` |
| `tests/venues.test.js` | 14 | `VENUES`-integritet, koordinater, överlappande kartnålar |

Testerna kör i tidszonen **Europe/Stockholm** (`vitest.config.js`). Det är inte kosmetika:
`nightKey()` drar bort sex timmar för att en fredag 00:30 ska höra till fredagskvällen, och
`closingHour()` jämför mot lokala klockslag. I UTC hamnar nattgränsen fel och ett test
på lördag morgon ger fredag.

### Tre tester är märkta KÄND BUGG

De låser fast ett **felaktigt** beteende så att det inte glöms. När buggen åtgärdas fallerar de,
och då ska de vändas. Se avsnitt 3.

---

## 2. Vad `scripts/check.js` faktiskt gör

Den läser `index.html`, `src/style.css` och `src/main.js` som **text** och letar efter strängar.

```js
check('Wait model: estimateWait + formatWait defined',
  js.includes('function estimateWait(') && js.includes('function formatWait('));
```

Detta är **inte ett test av beräkningen**. Det är ett test av att en viss teckensekvens finns i
filen. Kontrollen passerar oförändrat även om `estimateWait` returnerar fel siffra, dividerar med
noll eller alltid svarar `null`.

### Vad den faktiskt skyddar mot — och det är värdefullt

| Klass av fel | Exempel som fångades under utveckling |
|---|---|
| En funktion raderas av ett AI-verktyg | De två tillfällen `src/main.js` trunkerades |
| En `window`-exponering glöms bort | `/\n  onMyWayReport,/` kontrollerar att inline-handlers finns |
| En designkonvention bryts | `.erow--empty` får `opacity` direkt i stället för via keyframe |
| Ett konfigurationsvärde ändras av misstag | typsnittet, kartstilen, `people_ahead` i rapporter |
| Testdata läcker till produktion | `'Test data off by default (URL or secret Alt + 2 only)'` |

Det är alltså en **regressionsspärr för struktur och konvention**. Som sådan fungerar den bra och
bör behållas. Den ska bara inte förväxlas med ett test av logiken.

### Resultat vid senaste körning

```
53 passed, 0 failed
All checks passed ✓
```

### Två svagheter i check.js

1. **Rad 38 och 39 är attrapper.** `check('.env not committed', !hasEnvFile || true)` är alltid
   sant oavsett om `.env` finns. Samma gäller `check('No hardcoded supabase key…', true)`.
   Två av de 53 "godkända" kontrollerna kontrollerar ingenting.
2. **Kontrollerna är hårt bundna till radformuleringar.** Flera letar efter exakt kod, t.ex.
   `js.includes('result.data.filter(function(r) { return getVenueById(r.venue_id); })')`.
   En ofarlig omformulering av samma logik får kontrollen att fallera.

---

## 3. Buggen som testerna hittade

Första körningen av `tests/sessions.test.js` avslöjade ett fel i den viktigaste koden i appen.

`sessionRates` gissar takten utifrån intervallets bredd när någon står kvar i samma intervall:

```js
else if (mins >= 10) rate = (aheadBucket(first.people_ahead).width / 2) / mins;
if (rate !== null) out.push({ ... });
```

För `people_ahead: 0` är `width` **0**, så uttrycket blir `0`. Vakten är `rate !== null`, och
noll passerar den. Resultatet är en **uppmätt dörrtakt på noll** från någon som rapporterade att
det inte fanns någon kö.

**Nås genom ett normalt flöde:** rapportera "Ingen kö" → bannern frågar → "Jag är inne" tolv
minuter senare.

Två verifierade konsekvenser:

| Situation | Appen svarar | Borde svara |
|---|---|---|
| Kristall, 37 framför, en nollsession i historiken | **20–35 min** | 10–25 min |
| Kristall, 37 framför, två nollsessioner | **"Fullt"** | 10–25 min |

Det andra fallet är det värsta: två personer som gick rakt in tidigare under kvällen gör att
appen säger **"Fullt"** när kön börjar byggas — alltså i exakt det ögonblick någon står på
gatan och behöver ett rätt svar.

**Åtgärd** (en rad): kräv att intervallet har en bredd innan det gissas på den.

```js
else if (mins >= 10 && aheadBucket(first.people_ahead).width > 0)
```

**Inte åtgärdad.** Tre tester i `tests/sessions.test.js` är märkta `KÄND BUGG` och låser fast
dagens beteende. Rättas raden fallerar de, och då vänds de.

Ingen kontroll i `check.js` kunde ha hittat detta — koden ser korrekt ut, den räknar fel.

---

## 4. Vad som fortfarande inte testas — rangordnat efter risk

### Täckt sedan den här genomgången

Dessa åtta rena funktioner har nu tester. De testas genom `tests/harness.js`, som läser dem ur
`src/main.js` utan att någon kod flyttats:

| Funktion | Varför det betyder något |
|---|---|
| `estimateWait` | Producerar varje väntetid i appen |
| `sessionRates` | Mäter dörrens hastighet; fyra ogiltighetsregler |
| `setWaitRange` | Bestämmer osäkerhetsintervallet |
| `formatWait` | Sju grenar, varje felaktig gren är en synlig lögn |
| `waitToStatus` | Bestämmer färgen på kartan |
| `historicalRateFor` | Veckodags- och 12-timmarslogiken är lätt att bryta |
| `forecastWait` | Tre trösklar som ska hindra brus från att visas |
| `computeStatus` | Reservvägen när ingen väntetid finns |

**Alla åtta är rena funktioner.** De tar indata och returnerar utdata. De kräver ingen webbläsare,
ingen Supabase och ingen Mapbox.

### Hur hjälparen fungerar — och varför den är tillfällig

Funktionerna saknar `export` och ligger inne i `src/main.js` tillsammans med all DOM- och
Mapbox-kod, som inte kan köras i Node. `tests/harness.js` läser filen som text och klipper ut tre
block mellan **ankare**, inte radnummer:

| Block | Från | Till |
|---|---|---|
| `VENUES` | `const VENUES = [` | den avslutande klammern |
| Väntetidsmodellen | `var PACE_RATE` | `function getStatusLabel` |
| Fuzzy-sökningen | `function _searchNorm` | `// ── Utforska` |

Blocken körs med `new Function`, och `getVenueById` och `allReports` matas in som attrapper
eftersom de deklareras utanför blocken. Saknas ett ankare kastar hjälparen ett namngivet fel i
stället för att tysta ett test.

**Detta är byggnadsställning.** Den går sönder om ett ankarnamn ändras, och den ska inte finnas
kvar för alltid. Men den löser rätt problem i rätt ordning: testerna låser fast dagens beteende
**innan** koden rörs. När modellen senare flyttas till `src/model/` byts hjälparen mot vanliga
`import`-satser — samma testfall, samma förväntade värden. Går de från grönt till rött har flytten
ändrat beteendet, och då är det flytten som är fel, inte testet.

Att blocken verkligen är stabila är observerat: samma utfall före och efter att två commits tog
bort 158 rader ur `src/main.js`. Modellblocket låg oförändrat kvar.

Räkneexemplen i [QUEUE_LOGIC.md](QUEUE_LOGIC.md) avsnitt 5 finns nu som körbara testfall i
`tests/wait.test.js`.

### Högt: tillstånd när data saknas eller fallerar

Verifierat i webbläsare på HEAD `28040f2` (Playwright, 390×844, mockad Supabase). Samma tre lägen
kördes om efter att färskhetsraden ersatte den gamla summeringswidgeten.

| Vy | Tom databas | **Databasfel 500** |
|---|---|---|
| `#exsum-line` | "Inga rapporter än — bli först att rapportera" | **exakt samma text** ❌ |
| `#live-feed` | "Inga rapporter ännu. Nya köuppdateringar dyker upp här…" | **exakt samma text** ❌ |
| `#explore-list` | "Ingen data i kväll — rapportera" per rad ✅ | "Kunde inte ladda data / Kontrollera anslutningen / Försök igen" ✅ |
| Kartan (Mapbox nekad) | "Kartan kunde inte laddas / Övriga funktioner fungerar normalt" ✅ | samma ✅ |

Med testdata: `exsum-line` visar "17 av 28 ställen har färsk rapport · senast 1 min sedan", 28 rader
renderas med väntetider från `<5 min` till `Fullt`, inga konsolfel. ✅

**De två ❌-fallen är verifierade buggar, inte antaganden.** Grundorsaken är tydlig i koden:
`exsumText()` returnerar meningen om "inga rapporter" så snart `total === 0`, och `renderLiveFeed()`
kontrollerar bara `if (!supabase)` — ingen av dem känner till om inläsningen *misslyckades*.
`loadReports` fångar felet och anropar `showExploreError()`, men den signalen når bara
Utforska-listan.

Ingen kontroll i `check.js` kan upptäcka detta, eftersom felet uppstår i hur tillstånden
*kombineras* — inte i vilken kod som finns.

### Högt: rapportflödet

Inget test täcker: välja ställe → välja antal → `insert` → att siffran på skärmen ändras.
Flödet innehåller en 20-minutersspärr, en `queue_session`, en status som beräknas vid insättning,
ett RPC-anrop som misslyckas tyst, och en `loadReports()` efteråt. Varje steg är en möjlig
regression.

### Medel: realtid och pollning

Inget test täcker att en `insert` från en annan användare når skärmen, eller vad som händer när
Realtime och den 30-sekundersintervallen överlappar. Kräver en mockad WebSocket.

### Medel: skärmarna som renderar

`renderExploreVenues`, `renderLiveFeed`, `renderQueueSessionBanner` och `updateProfileStats`
bygger HTML-strängar och rör DOM. De kan bara testas i en webbläsare — se steg 2 nedan.

---

## 5. Hur en ändring bör verifieras idag

```bash
# 1. Allt maskinellt: tester, strukturkontroller, bygge
npm run verify

# 2. Manuellt i webbläsaren, med testdata
npm run dev
# öppna http://localhost:5173/?testdata=true
```

Under arbete med modellen: `npm run test:watch` kör om testerna vid varje sparning.

### Manuell checklista före en release

Testdata måste vara på, annars syns inga väntetider alls utan riktiga rapporter.

- [ ] **Karta** — nålar har rätt färg, kluster visas vid utzoomning, en nål går att trycka på
- [ ] **Utforska** — färskhetsraden stämmer ("N av 28 ställen"), rader sorterade, tomma ställen sist
- [ ] **Väntetider** — intervall visas (`25–50 min`), aldrig en naken siffra
- [ ] **Live** — flödet har rapporter, grupperade per ställe, klockslag stämmer
- [ ] **Rapportera** — alla tre stegen, bekräftelsen visas, listan återställs
- [ ] **Profil** — rapporter, poäng, nivå, streak
- [ ] **Utan testdata** (`localhost:5173`) — ingen falsk data syns någonstans
- [ ] **Offline / databasfel** — felläge i stället för tom skärm
- [ ] **Smal skärm** (390 px) — inget horisontellt skrollande, text läsbar

---

## 6. Begränsningar i testmiljön

Dessa påverkar vad som går att verifiera var.

| Begränsning | Konsekvens |
|---|---|
| **Supabase-domänen är blockerad i molnmiljöns nätverkspolicy** | Databasschemat kan inte läsas härifrån. Alla databastester måste mocka svaret, eller köras lokalt. |
| **Mapbox-domänen är blockerad i molnmiljön** | Kartan kan inte renderas i verifiering härifrån. Felläget går däremot att testa. |
| Playwright + Chromium finns i molnmiljön men **inte i `package.json`** | Webbläsartester är inte reproducerbara på en annan maskin |
| Ingen CI | Inget körs automatiskt vid push |
| Realtime-WebSocket kan inte nås | Realtidsflödet går inte att verifiera automatiskt |

Mockning av Supabase fungerar och användes för verifieringen i avsnitt 3:

```js
await page.route('**/*.supabase.co/**', r => r.fulfill({
  status: 200, contentType: 'application/json',
  headers: { 'content-range': '0-0/0' }, body: '[]'
}));
```

---

## 7. Rekommenderad väg framåt

### ✅ Klart — enhetstester på modellen och `npm run verify`

Vitest, 110 tester i fem filer, och ett kommando som kör allt. Den första körningen hittade en
bugg i `sessionRates` (avsnitt 3).

### Steg 1 — Spärr före commit

```bash
npm i -D husky && npx husky init
echo "npm run verify" > .husky/pre-commit
```

Då **kan** inget trasigt committas, oavsett vilket verktyg som gjorde ändringen. Det hade stoppat
båda tillfällena då `src/main.js` trunkerades.

### Steg 2 — Playwright som devDependency, fyra tester

```bash
npm i -D @playwright/test
```

Begränsa till flöden som enhetstester inte kan nå:

1. Appen startar, Utforska-listan renderar med mockad data
2. **Databasfel visar felläge i alla tre vyer** — fångar de två buggarna i avsnitt 4
3. Sök → välj ställe → venue-kortet öppnas
4. Rapportflödets tre steg med mockad `insert`

Mockningen som användes för verifieringen i avsnitt 4 fungerar och kan återanvändas rakt av.
Playwright finns i den här utvecklingsmiljön men saknas i `package.json`, så webbläsartester är
ännu inte reproducerbara på en annan maskin.

### Steg 3 — CI som kör `npm run verify` vid varje push

`.github/workflows/verify.yml`. Det är den enda kontrollen som är oberoende av vilken agent eller
människa som gjorde ändringen, och en förutsättning för agentflödet.

### Steg 4 — Städa check.js

Ta bort de två attrapp-kontrollerna (avsnitt 2), och gör en riktig kontroll av att `.env` inte är
spårad:

```bash
git ls-files --error-unmatch .env   # ska misslyckas
```

### Steg 5 — Flytta modellen till `src/model/`

**Först nu**, när testerna finns. De bevisar att flytten inte ändrar beteendet: `tests/harness.js`
byts mot vanliga `import`-satser och alla 110 testerna ska fortsätta passera. Det öppnar också för
att Expo-appen kan importera samma modell, som den i dag helt saknar.
