# QueueBar — Test och verifiering

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).

---

## 1. Vad som finns idag

| Verktyg | Finns | Kommando |
|---|---|---|
| `scripts/check.js` — 53 strängkontroller | ✅ | `node scripts/check.js` |
| Produktionsbygge | ✅ | `npm run build` |
| Utvecklingsserver | ✅ | `npm run dev` |
| Enhetstester | ❌ | — |
| Integrationstester | ❌ | — |
| E2E-tester / webbläsartester | ❌ | — |
| Linter | ❌ | — |
| Typkontroll | ❌ | — |
| CI (GitHub Actions eller liknande) | ❌ | — |
| Spärr före commit | ❌ | — |

Det finns **inget testramverk** i `package.json`. Det finns inget `"test"`-script.

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

## 3. Vad som inte testas — rangordnat efter risk

### Kritiskt: väntetidsmodellen

Hela appens värde ligger i att siffran är rätt. Ingen av dessa funktioner har ett test:

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

### Att de går att testa utan att flytta kod är bevisat

Funktionerna saknar `export` och ligger inne i `src/main.js` tillsammans med all DOM-kod. Det
behöver **inte** blockera tester. Ett provskript läste `src/main.js` som text, klippte ut `VENUES`
och modellblocket mellan ankarna `var PACE_RATE` och `function getStatusLabel`, och körde dem i
Node med `new Function`. På HEAD `28040f2` gav det:

```
VENUES: 28 ställen
  ✓ 37 före, pace=slow   → 25–50 min
  ✓ 37 före, pace=fast   → 10–15 min
  ✓ 0 före               → Ingen kö
  ✓ 60 före, pace=slow   → 40+ min
  ✓ 5 före, pace=fast    → <5 min
  ✓ rapport 50 min gammal → null
  sessionRates: 1.00 pers/min  (30 min, 37→7)
  för kort / negativ rörelse / en punkt → 0 takter
6 av 6 kända svar stämmer.
```

Samma utfall före och efter att två commits tog bort 158 rader ur filen — modellblocket låg
oförändrat kvar.

Textutklipp är **tillfällig byggnadsställning** och går sönder om funktionsnamnen ändras. Men det
löser rätt problem i rätt ordning: testerna låser fast dagens beteende **innan** koden rörs, och
därefter är en flytt till `src/model/` bevisbart beteendebevarande — samma testfall måste passera
mot den importerade modulen. Går de från grönt till rött har flytten ändrat något.

Siffrorna i [QUEUE_LOGIC.md](QUEUE_LOGIC.md) avsnitt 5 är redan färdiga testfall med kända svar.
**De finns ännu inte kvar som en körbar kontroll i repot.**

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

### Medel: sökningen

`venueScore` har tio poängnivåer med längdgrindar (minst 2 eller 3 tecken för vissa
nivåer). Den är ren och väldokumenterad i koden, och exakt den sortens funktion där en ändring i
en gren tyst förstör en annan. Inget test.

### Medel: venue-datans integritet

Inget test fångar: dubbla id, saknade fält, koordinater utanför Stockholm, två ställen på samma
punkt. Den här genomgången hittade **tio par under 60 m** och **ett par på 3 m** med ett
20-raders skript. Det skriptet finns inte kvar i repot.

---

## 4. Hur en ändring bör verifieras idag

Så här ser den fungerande arbetsgången ut med nuvarande verktyg:

```bash
# 1. Strukturkontroller
node scripts/check.js

# 2. Att bygget går igenom
npm run build

# 3. Manuellt i webbläsaren, med testdata
npm run dev
# öppna http://localhost:5173/?testdata=true
```

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

## 5. Begränsningar i testmiljön

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

## 6. Rekommenderad väg framåt

Ordningen är vald så att varje steg är litet och ger skydd direkt.

### Steg 1 — Enhetstester på modellen (högsta värde per timme)

```bash
npm i -D vitest
```

```
tests/wait.test.js       estimateWait, setWaitRange, formatWait, waitToStatus
tests/sessions.test.js   sessionRates: de fyra ogiltighetsreglerna, width-fallet
tests/history.test.js    historicalRateFor: veckodag, ±1 h, 12-timmarsregeln, ≥3
tests/search.test.js     venueScore: de tio nivåerna och längdgrindarna
tests/venues.test.js     VENUES: id unika, alla fält, inga två punkter under 25 m
```

Tabellen i [QUEUE_LOGIC.md](QUEUE_LOGIC.md) avsnitt 5 är färdiga testfall med kända svar.

**Förutsättning:** funktionerna måste gå att importera. Idag ligger de inuti `src/main.js`
tillsammans med all DOM-kod, så de kan inte importeras utan att en webbläsarmiljö krävs. Att
flytta de rena funktionerna till en egen fil är därför en förutsättning för steg 1 — och den
ändringen är i sig riskfri eftersom funktionerna inte har några sidoeffekter.

### Steg 2 — Ett enda kommando

```json
"test": "vitest run",
"verify": "vitest run && node scripts/check.js && vite build"
```

### Steg 3 — Spärr före commit

Så att inget trasigt kan committas, oavsett vilket verktyg som gjorde ändringen.

### Steg 4 — Playwright som devDependency, fyra tester

Begränsa till de flöden som inte går att täcka med enhetstester:

1. Appen startar, Utforska-listan renderar med mockad data
2. **Databasfel visar felläge i alla tre vyer** (fångar de två buggarna i avsnitt 3)
3. Sök → välj ställe → venue-kortet öppnas
4. Rapportflödets tre steg med mockad `insert`

Playwright finns redan i den här utvecklingsmiljön och användes för verifieringen ovan, men saknas
i `package.json` och är därför inte reproducerbart för andra.

### Steg 5 — Städa check.js

Ta bort de två attrapp-kontrollerna, och gör en riktig kontroll av att `.env` inte är spårad:

```bash
git ls-files --error-unmatch .env   # ska misslyckas
```
