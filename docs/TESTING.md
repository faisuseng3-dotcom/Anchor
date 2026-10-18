# QueueBar — Test och verifiering

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `395f59e`).

---

## 1. Vad som finns idag

| Verktyg | Finns | Kommando |
|---|---|---|
| `scripts/check.js` — 57 strängkontroller | ✅ | `node scripts/check.js` |
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
57 passed, 0 failed
All checks passed ✓
```

### Två svagheter i check.js

1. **Rad 38 och 39 är attrapper.** `check('.env not committed', !hasEnvFile || true)` är alltid
   sant oavsett om `.env` finns. Samma gäller `check('No hardcoded supabase key…', true)`.
   Två av de 57 "godkända" kontrollerna kontrollerar ingenting.
2. **Kontrollerna är hårt bundna till radformuleringar.** Flera letar efter exakt kod, t.ex.
   `js.includes('result.data.filter(function(r) { return getVenueById(r.venue_id); })')`.
   En ofarlig omformulering av samma logik får kontrollen att fallera.

---

## 3. Vad som inte testas — rangordnat efter risk

### Kritiskt: väntetidsmodellen

Hela appens värde ligger i att siffran är rätt. Ingen av dessa funktioner har ett test:

| Funktion | Rader | Varför det betyder något |
|---|---|---|
| `estimateWait` | `:297` | Producerar varje väntetid i appen |
| `sessionRates` | `:244` | Mäter dörrens hastighet; fyra ogiltighetsregler |
| `setWaitRange` | `:323` | Bestämmer osäkerhetsintervallet |
| `formatWait` | `:366` | Sju grenar, varje felaktig gren är en synlig lögn |
| `waitToStatus` | `:377` | Bestämmer färgen på kartan |
| `historicalRateFor` | `:285` | Veckodags- och 12-timmarslogiken är lätt att bryta |
| `forecastWait` | `:331` | Tre trösklar som ska hindra brus från att visas |
| `computeStatus` | `:392` | Reservvägen när ingen väntetid finns |

**Alla åtta är rena funktioner.** De tar indata och returnerar utdata. De kräver ingen webbläsare,
ingen Supabase och ingen Mapbox. Det finns inget tekniskt hinder för att testa dem — bara avsaknad
av ett testramverk.

Siffrorna i [QUEUE_LOGIC.md](QUEUE_LOGIC.md) avsnitt 5 räknades fram genom att replikera koden
manuellt för den här genomgången. **De finns inte kvar som en körbar kontroll.**

### Högt: tillstånd när data saknas eller fallerar

Verifierat i webbläsare under den här genomgången (Playwright, 390×844, mockad Supabase):

| Läge | Resultat | Bedömning |
|---|---|---|
| Tom databas | 28 rader med `–` som väntetid, widget säger "inga rapporter" | ✅ ärligt |
| Databasfel 500 | Utforska-listan visar "Kunde inte ladda data / Försök igen" | ✅ korrekt |
| Databasfel 500 | **Widgeten "Stockholm just nu" visar `0 / 0 / 0` och "Inga rapporter än — bli först att rapportera"** | ❌ **presenterar ett serverfel som en lugn kväll** |
| Databasfel 500 | **Live-flödet visar "Inga rapporter ännu. Gå ut och rapportera!"** | ❌ **samma fel** |
| Mapbox otillgängligt | "Kartan kunde inte laddas / Övriga funktioner fungerar normalt" | ✅ korrekt |
| Testdata på | 28 rader, väntetider `5–10 min` … `Fullt`, inga konsolfel | ✅ fungerar |

De två ❌-fallen är verifierade buggar, inte antaganden. Ingen kontroll i `check.js` kan upptäcka
dem eftersom de uppstår i hur tillstånden *kombineras*, inte i vilken kod som finns.

### Högt: rapportflödet

Inget test täcker: välja ställe → välja antal → `insert` → att siffran på skärmen ändras.
Flödet innehåller en 20-minutersspärr, en `queue_session`, en status som beräknas vid insättning,
ett RPC-anrop som misslyckas tyst, och en `loadReports()` efteråt. Varje steg är en möjlig
regression.

### Medel: sökningen

`venueScore` (`:1985`) har tio poängnivåer med längdgrindar (minst 2 eller 3 tecken för vissa
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
- [ ] **Utforska** — "Stockholm just nu" summerar, rader sorterade, tomma ställen sist
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
