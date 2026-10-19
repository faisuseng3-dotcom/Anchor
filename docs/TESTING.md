# QueueBar — Test och verifiering

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).

---

## 1. Vad som finns idag

| Verktyg | Finns | Kommando |
|---|---|---|
| **Vitest — 120 enhetstester** | ✅ | `npm test` |
| **Playwright — 10 E2E-tester** | ✅ | `npm run e2e` |
| `scripts/check.js` — 56 strängkontroller | ✅ | `node scripts/check.js` |
| **Hela kedjan i ett kommando** | ✅ | `npm run verify` |
| **Spärr före commit** | ✅ | automatiskt, `.husky/pre-commit` |
| **CI vid varje push** | ✅ | `.github/workflows/verify.yml` |
| Produktionsbygge | ✅ | `npm run build` |
| Utvecklingsserver | ✅ | `npm run dev` |
| Linter | ❌ | medvetet uppskjutet, se nedan |
| Typkontroll | ❌ | — |

```bash
npm run verify   # vitest run && node scripts/check.js && vite build
```

**Den körs automatiskt före varje commit** (husky). Du behöver inte komma ihåg det — spärren sätts
upp av `npm install`. `--no-verify` hoppar över den; gör det bara när du vet varför.

E2E-testerna ingår inte i `verify`, eftersom de kräver en webbläsarbinär som inte finns på en ny
maskin. Första gången:

```bash
npx playwright install chromium
npm run e2e
```

CI kör båda vid varje push. Det är den enda kontrollen som inte går att hoppa över.

### Testfilerna

| Fil | Tester | Täcker |
|---|---|---|
| `tests/harness.js` | — | Läser de rena funktionerna ur `src/main.js` + testdatabyggare |
| `tests/wait.test.js` | 37 | `estimateWait`, `setWaitRange`, `formatWait`, `waitToStatus`, `aheadBucket`, `median` |
| `tests/sessions.test.js` | 24 | `sessionRates`, `measureQueueRates` — alla ogiltighetsregler |
| `tests/history.test.js` | 14 | `historicalRateFor`, `nightKey` |
| `tests/search.test.js` | 22 | `venueScore`, `venueSearch`, `_searchNorm` |
| `tests/venues.test.js` | 14 | `VENUES`-integritet, koordinater, överlappande kartnålar |
| `tests/loadstate.test.js` | 9 | `exsumText` — serverfel får aldrig se ut som en tyst kväll |
| `e2e/support.js` | — | Supabase-mock, rapportbyggare, uppstart |
| `e2e/app.spec.js` | 10 | Start, feltillstånd, sök, rapportflödet, kartans felläge |

Testerna kör i tidszonen **Europe/Stockholm** (`vitest.config.js`). Det är inte kosmetika:
`nightKey()` drar bort sex timmar för att en fredag 00:30 ska höra till fredagskvällen, och
`closingHour()` jämför mot lokala klockslag. I UTC hamnar nattgränsen fel och ett test
på lördag morgon ger fredag.

### Fem tester skyddar sessionRates

De hindrar att "Ingen kö" åter blir en uppmätt dörrtakt på noll. Se avsnitt 3.

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
56 passed, 0 failed
All checks passed ✓
```

### Två svagheter i check.js

1. **Rad 38 och 39 är attrapper.** `check('.env not committed', !hasEnvFile || true)` är alltid
   sant oavsett om `.env` finns. Samma gäller `check('No hardcoded supabase key…', true)`.
   Två av de 56 "godkända" kontrollerna kontrollerar ingenting.
2. **Kontrollerna är hårt bundna till radformuleringar.** Flera letar efter exakt kod, t.ex.
   `js.includes('result.data.filter(function(r) { return getVenueById(r.venue_id); })')`.
   En ofarlig omformulering av samma logik får kontrollen att fallera.

---

## 3. Buggen som testerna hittade — och åtgärdade

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

### Åtgärdad

```js
else if (mins >= 10 && aheadBucket(first.people_ahead).width > 0) {
  rate = (aheadBucket(first.people_ahead).width / 2) / mins;
}
```

Villkoret säger vad som faktiskt gäller: man kan bara gissa utifrån intervallets bredd om
intervallet **har** en bredd. En session med 0 framför i båda ändar förkastas nu, som vilken annan
session som inte mätt något.

**Hur åtgärden verifierades, i tre steg:**

1. **Testerna fallerade först.** De fyra `KÄND BUGG`-testerna gick från grönt till rött när raden
   ändrades, och exakt de fyra — de 19 övriga i filen fortsatte passera. Det bevisar att fixen biter
   på rätt beteende och inget annat.
2. **Testerna vändes.** De asserterar nu korrekt beteende: sessionen förkastas, väntetiden är
   oförändrad, `full` är `false`. Ett femte test lades till som bevisar att en session som *faktiskt*
   rört sig till noll (17 framför → inne efter 20 min) fortfarande mäts — fixen får inte kasta bort
   riktiga mätningar.
3. **Verifierat i webbläsare** med mockad Supabase: två nollsessioner för Kristall plus en rapport
   om 37 framför, och ett kontrollställe med samma `pace` och samma kölängd utan nollsessioner.

```
Kristall    (två nollsessioner + 37 framför): 10–25 min
Golden Hits (bara 37 framför, kontroll)    : 10–25 min
```

Före åtgärden visade Kristall **"Fullt"**.

En kontroll i `check.js` letar nu efter vakten, så att den inte kan försvinna tyst:

```js
check('Wait model: width-guess requires a non-zero bucket width',
  js.includes('aheadBucket(first.people_ahead).width > 0'));
```

**Lärdomen är viktigare än buggen.** Ingen kontroll i `check.js` kunde ha hittat detta från början
— koden såg korrekt ut, den räknade fel. Det är hela skälet till att enhetstester av modellen var
den högst prioriterade åtgärden, och buggen dök upp i det första testet som skrevs för
`sessionRates`.

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

**Åtgärdat.** Fyra lägen, verifierade i webbläsare och nu åtskilda:

| Läge | `#exsum-line` | Live-flödets underrad | `.erow`-rader |
|---|---|---|---|
| Tom databas | "Inga rapporter än — bli först att rapportera" | "Inga rapporter senaste 45 min" | 28 |
| **Fel, ingen data** | "Ingen kontakt med servern" + röd prick | "Ingen kontakt" | 0, felläge i listan |
| **Fel, data kvar** | "Ingen kontakt med servern · siffrorna kan vara gamla" + prick | "Ingen kontakt · kan vara gammalt" | 28 **behållna** |
| Normalt | "2 av 28 ställen har färsk rapport · senast 3 min sedan" | "2 ställen · 45 min" | 28 |

Kartan hanterade felet korrekt redan innan: "Kartan kunde inte laddas / Övriga funktioner fungerar
normalt".

Före åtgärden gav de två första lägena **exakt samma text** i både färskhetsraden och Live-flödet.
Ett serverfel såg ut som en tyst kväll i Stockholm.

Med testdata: `exsum-line` visar "17 av 28 ställen har färsk rapport · senast 1 min sedan", 28 rader
renderas med väntetider från `<5 min` till `Fullt`, inga konsolfel. ✅

### Grundorsaken, och hur den löstes

`exsumText()` returnerade meningen om "inga rapporter" så snart `total === 0`, och `renderLiveFeed()`
kontrollerade bara `if (!supabase)`. Ingen av dem kunde veta om inläsningen *misslyckades*.
`loadReports` fångade felet och anropade `showExploreError()`, men den signalen nådde bara
Utforska-listan.

Löst med en `_loadState` (`'loading' | 'ok' | 'error'`) som sätts i `loadReports` och läses av de
vyer som annars inte kan skilja lägena åt.

Två designbeslut är värda att bevara:

1. **`exsumText(d, state)` tar tillståndet som argument**, inte från den globala variabeln. Det är
   enda skälet att funktionen kan enhetstestas utan DOM — de nio testerna i
   `tests/loadstate.test.js` finns bara tack vare det. Görs den om till att läsa `_loadState`
   direkt försvinner testbarheten.
2. **`renderLoadFailure()` kastar inte bort data som redan finns.** Att tömma en fungerande lista
   för att en enda pollning missade är sämre än att visa den med en varning, så
   `showExploreError()` körs bara när `allReports` är tom. Därav det tredje läget i tabellen.

Ingen kontroll i `check.js` kunde ha hittat detta från början, eftersom felet uppstod i hur
tillstånden *kombinerades* — inte i vilken kod som fanns. Nu finns en kontroll som ser till att
`_loadState` och `exsumText(d, state)` är kvar.

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

### ✅ Klart — enhetstester, spärr före commit, E2E och CI

| Steg | Resultat |
|---|---|
| Enhetstester på modellen | Vitest, 120 tester i sex filer. Första körningen hittade `sessionRates`-buggen (avsnitt 3) |
| Ett kommando | `npm run verify` — tester, kontroller, bygge |
| Spärr före commit | `.husky/pre-commit`, sätts upp av `npm install` |
| E2E | Playwright, 10 tester i `e2e/`, mobil viewport, mockad Supabase |
| CI | `.github/workflows/verify.yml` — två jobb, `verify` och `e2e` |

Två saker som verifierades under arbetet och är värda att komma ihåg:

**Spärren provades med en medvetet trasig fil.** Committen blockerades — och det var **bygget** som
fångade syntaxfelet, inte testerna. Hjälparen klipper bara ut vissa block ur `src/main.js`, så ett
fel utanför dem syns inte för `vitest`. Det är därför `vite build` hör i spärren och inte bara i CI.

**E2E-testerna provades mot den återinförda buggen.** `_loadState`-fixen backades tillfälligt, och
två av tre feltillståndstester fallerade medan det tredje korrekt fortsatte passera. Ett test som
aldrig setts fallera är inte ett bevis på någonting.

### Kvar: städa check.js

Rad 38 och 39 är attrapper som alltid är sanna. Ersätt med en riktig kontroll av att `.env` inte är
spårad:

```bash
git ls-files --error-unmatch .env   # ska misslyckas
```

### Kvar: en linter — medvetet uppskjutet

ESLint på en 3 187-radersfil i ES5-stil (`var`, `function`, inga moduler) skulle ge hundratals
varningar och kräva konfigurationsbeslut som ingen tagit. Den ger mest värde **efter** att modellen
flyttats till `src/model/`, när filerna är små nog att städa en i taget. Att slå på den nu skulle
betyda antingen hundratals ignorerade varningar eller en stor omskrivning utan testtäckning i de
delar som inte är rena funktioner.

### Kvar: flytta modellen till `src/model/`

**Först nu**, när testerna finns. De bevisar att flytten inte ändrar beteendet: `tests/harness.js`
byts mot vanliga `import`-satser och alla 120 testerna ska fortsätta passera. Går de från grönt till
rött är det flytten som är fel, inte testet.

Det öppnar också för att Expo-appen kan importera samma modell, som den i dag helt saknar.
