# QueueBar — Köberäkningen

Verifierad mot koden 2026-10-18 på grenen `redesign` (HEAD `28040f2`).
Alla siffror i exemplen är **räknade ut genom att replikera koden**, inte uppskattade.

**Detta dokument beskriver logiken som den är.** Brister är dokumenterade i avsnitt 9 men inga
ändringar har gjorts.

---

## 1. Grundidén

```
väntetid = antal personer framför dig ÷ hur snabbt dörren släpper in folk
```

Det här är hela modellen. Allt annat är lager som besvarar frågan: *hur snabbt släpper den här
dörren in folk just nu, och hur säkra är vi på det?*

Problemet modellen löser: **samma kölängd betyder olika väntetid på olika ställen.** 37 personer
framför dig på Spy Bar (långsam dörr) är 25–50 minuter. 37 personer på Soap Bar (snabb dörr) är
10–15 minuter. Ett system som bara visade "lång kö" på båda skulle vara fel på det ena.

---

## 2. Så mäts kölängden

Användaren trycker på ett intervall, inte en siffra. Det lagrade `people_ahead` är intervallets
**mittvärde** (`AHEAD_BUCKETS`, `src/main.js`):

| Knappen säger | `people_ahead` | `width` |
|---|---|---|
| Ingen kö | 0 | 0 |
| 1–10 | 5 | 9 |
| 10–25 | 17 | 15 |
| 25–50 | 37 | 25 |
| 50+ | 60 | 30 |

`width` används bara i hastighetsmätningen (avsnitt 3).

### Vilken kölängd används?

`estimateWait` (`src/main.js`):

1. Ta alla rapporter för stället där `report_type` är `'initial'` (eller saknas), `people_ahead`
   finns, och åldern är **0–45 minuter**.
2. Finns några under **20 minuter** gamla: använd **medianen** av dem.
3. Annars: använd **enbart den senaste** rapporten.
4. Finns ingen rapport inom 45 minuter: returnera `null` → stället visas som "ingen data".

Median, inte medelvärde. En avvikande rapport bland tre kan därför inte dra iväg siffran.

**Bara `initial` räknas som en kömätning** (`isQueueReport`). En `followup` är samma persons
nya position i samma kö, inte en ny mätning av köns längd — att räkna den vore dubbelräkning.

---

## 3. Så mäts dörrens hastighet

En **kö-session** är en persons väg genom en kö: en `initial`, noll till fyra `followup`, och
eventuellt en `entered`. Alla delar samma `queue_session`-id.

`sessionRates` (`src/main.js`) ger **en hastighet per session**:

```
rörelse = första mätningens people_ahead − sista mätningens people_ahead
tid     = minuter mellan första och sista mätningen
```

Regler som gör en session ogiltig:

| Villkor | Varför |
|---|---|
| Färre än 2 mätpunkter | Ingen rörelse går att mäta |
| `tid < 4 min` | För kort för att säga något om takten |
| `tid > 90 min` | Sessionen är övergiven, inte en kö |
| `rörelse < 0` | Kön blev längre framför en enskild person — orimligt, data förkastas |

Två utfall:

- **`rörelse > 0`** → `takt = rörelse / tid` personer per minut.
- **`rörelse = 0`, `tid ≥ 10 min` och `width > 0`** → personen står kvar i samma intervall.
  Rörelsen är okänd men mindre än intervallets bredd, så takten uppskattas till `(width / 2) / tid`.
  Detta är avsiktligt: att sätta takten till 0 vore att hävda att kön står helt still, vilket inte
  följer av datan.
- **`rörelse = 0` och `width = 0`** → sessionen förkastas. Intervallet "Ingen kö" har bredden 0,
  och någon som rapporterat 0 framför i båda ändar har inte mätt dörren alls.

Villkoret `width > 0` i sista punkten är inte kosmetika. Utan det blev `(0/2)/tid` = **0**, och
vakten `rate !== null` släppte igenom nollan som en uppmätt dörrtakt. Effekten var att en person
som rapporterade att det inte fanns någon kö förlängde väntetiden för alla andra, och att två
sådana sessioner fick appen att visa **"Fullt"** när kön började byggas. Låst fast av fem tester i
`tests/sessions.test.js`.

`measureQueueRates` hämtar kvällens sessioner: samma ställe, **senaste 45 minuterna**.

---

## 4. Tre lager för takten

Vilken takt som används avgörs i `estimateWait` i den här ordningen:

| Lager | Källa | Krav | `source` |
|---|---|---|---|
| 1 | **Kvällens mätningar** — `measureQueueRates` | ≥1 session senaste 45 min | `'live'` |
| 2 | **Tidigare kvällar** — `_historicalRates` | samma ställe, samma veckodag, ±1 h, **≥3 sessioner** | `'history'` |
| 3 | **Startgissning** — `venue.pace` | alltid | `'estimate'` |

`PACE_RATE`: `slow: 1.0`, `normal: 2.0`, `fast: 3.0` personer per minut.

### Hur lagren blandas

Lager 1 **ersätter inte** de lägre lagren — det blandas med dem:

```js
rate = n ? (n * measuredRate + 2 * prior) / (n + 2) : prior
```

där `n` är antalet mätta sessioner och `prior` är lager 2 om det finns, annars lager 3.

Priorn väger alltså som **två sessioner**. Det är en medveten dämpning: en enda session med
avvikande takt ska inte ensam styra vad alla ser. Men det gör också priorn **trög** —
se avsnitt 9.

### Historiklagret i detalj

`historicalRateFor` och `nightKey`:

- **Kvällen räknas från 06:00.** `nightKey` drar bort 6 timmar innan veckodagen läses ut, så
  fredag 00:30 tillhör torsdagskvällen räknat som "fredagsnatt" — alltså samma kväll som
  torsdag 23:00. Detta gör att en session efter midnatt matchar mot rätt kväll.
- Sessioner **inom 12 timmar** från den aktuella tidpunkten utesluts, så att ikväll inte räknas
  som sin egen historik.
- Kräver **minst 3 matchande sessioner**, annars faller lagret bort.
- Använder **medianen** av de matchande takterna.

Datan hämtas av `loadHistoricalRates`: kö-sessioner 8 veckor bakåt, **limit 1000**,
som sedan räknas om var 30:e minut.

---

## 5. Osäkerhet och formatering

`setWaitRange` lägger ett intervall runt punktskattningen:

| Antal mätta sessioner | Spridning |
|---|---|
| ≥3 | **±20 %** |
| 0–2 | **±35 %** |

Gränserna avrundas till närmaste 5 minuter. `formatWait` väljer text:

| Villkor | Visas |
|---|---|
| `full` | `Fullt` |
| `ahead === 0` | `Ingen kö` |
| `high <= 5` | `<5 min` |
| `high > 60` | `40+ min` |
| `low < 5` | `<15 min` |
| `low === high` | `~20 min` |
| annars | `25–50 min` |

**Det visas aldrig en naken siffra utan osäkerhetsmarkering.** Antingen ett intervall, ett `~`,
ett `<` eller ett `+`.

### "Fullt"

```js
est.full = n >= 2 && measuredRate < 0.3 && ahead >= 10
```

Kräver **minst två mätta sessioner ikväll**, en uppmätt takt under 0,3 personer per minut, och
minst 10 personer framför. Det går alltså inte att visa "Fullt" på enbart `venue.pace` eller på
historik — bara på faktiska mätningar ikväll. Det är avsiktligt: "Fullt" är det starkaste påståendet
appen gör och får inte vara en gissning.

### Verifierade exempel

Räknade genom att replikera koden:

| Situation | Takt | Minuter | Visas | Källa |
|---|---|---|---|---|
| 37 före, `pace: slow`, inga mätningar | 1,00 | 37,0 | **25–50 min** | estimate |
| 37 före, `pace: fast`, inga mätningar | 3,00 | 12,3 | **10–15 min** | estimate |
| 37 före, `pace: slow`, 1 mätning à 1,2/min | 1,07 | 34,7 | **25–45 min** | live |
| 37 före, `pace: slow`, 3 mätningar à 1,2/min | 1,12 | 33,0 | **25–40 min** | live |
| 17 före, `pace: normal`, 2 mätningar à 0,1/min | 1,05 | 16,2 | **Fullt** | live |
| 5 före, `pace: fast`, inga mätningar | 3,00 | 1,7 | **<5 min** | estimate |
| 0 före | — | 0 | **Ingen kö** | — |
| 60 före, `pace: slow`, inga mätningar | 1,00 | 60,0 | **40+ min** | estimate |

Samma kölängd (37) ger 10–15 min eller 25–50 min beroende på dörren. Det är modellens hela poäng.

---

## 6. Från väntetid till status och färg

`waitToStatus` gör om minuter till en nivå:

| Villkor | Status | Färg |
|---|---|---|
| `full` | `long` | `#FF4D5E` |
| `ahead === 0` eller `mins < 3` | `none` | `#34E07F` |
| `mins < 18` | `short` | `#FFD23F` |
| `mins < 30` | `medium` | `#FF8A3D` |
| annars | `long` | `#FF4D5E` |

**Statusen är alltså härledd ur väntetiden, inte rapporterad.** Den `queue_status` som sparas i
databasen beräknas också med `waitToStatus` vid insättning och används bara som reserv
för gamla rapporter utan `people_ahead`.

### Reservvägen

`computeStatus` används när `estimateWait` returnerar `null`:

1. Finns en väntetidsskattning → `waitToStatus(est)`.
2. Annars: ta `initial`-rapporter för stället. Finns ingen → `'unknown'`.
3. Ta de som är färskare än 45 minuter; finns inga, ta **enbart den senaste** oavsett ålder.
4. Returnera den **vanligaste** `queue_status` i den gruppen.

Steg 3 är värt att känna till: en rapport från i förrgår kan avgöra statusen om inget nyare finns.
Gränssnittet markerar detta genom tidsstämpeln i raden, men **statusfärgen degraderas inte** med
åldern.

---

## 7. Motstridiga rapporter

Modellen hanterar oenighet på tre sätt, utan att någonsin låta en enskild rapport dominera:

| Mekanism | Funktion | Effekt |
|---|---|---|
| **Median** av färska kölängder | `estimateWait` | En avvikande rapport bland tre ignoreras |
| **Median** av mätta takter | `estimateWait` | En ovanligt snabb eller långsam session jämnas ut |
| **Prior-dämpning** (väger som 2 sessioner) | `estimateWait` | Ny, tunn mätdata kan inte svänga siffran helt |
| **Negativ rörelse förkastas** | `sessionRates` | Orimliga sessioner räknas inte alls |

Det finns **ingen röstning, ingen användarviktning och inget ryktessystem.** Alla rapportörer väger
lika. (Ett oanvänt tillförlitlighetsmått, `computeConfidence`, är borttaget.)

---

## 8. Prognos och kalibrering

### `forecastWait` — kön när du är framme

Används av "På väg"-bannern. Kräver:

- minst **3 `initial`-rapporter** senaste 30 minuterna,
- som sträcker sig över minst **10 minuter**,
- och att man är minst 5 minuter bort.

Annars returneras `null` och bannern visar "kön nu" i stället. Trenden extrapoleras linjärt och
andra som är på väg läggs till med **halv vikt** (`othersOnWay / 2`), eftersom inte alla som
säger att de är på väg faktiskt kommer.

### `computeCalibration` — håller modellen ärlig

För varje avslutad session med `entered`: räkna om vad appen **hade** sagt när sessionen startade,
och jämför med den verkliga väntetiden.

```
fel = verklig tid − förutsagd tid      (plus = appen lovade för kort väntan)
```

Rapporterar per ställe: antal sessioner, medianfel i minuter, bias, och andel som låg inom det
visade intervallet. Nås genom att skriva **`qbCalibration()`** i webbläsarkonsolen.

Detta är den enda mekanismen som kan visa om modellen faktiskt stämmer. Den kräver verkliga
"Jag är inne"-rapporter och ger inget svar förrän sådana finns.

---

## 9. Brister i den nuvarande logiken

**Dokumenterade, inte åtgärdade.** Förslag till lösning finns i granskningen.

### B-01 — Priorn är trög (bekräftad egenskap)

Med tre mätta sessioner väger `venue.pace` fortfarande 40 %:

```
3 mätningar à 1,2/min på ett ställe med pace 'slow' (1,0)  →  blandad takt 1,12
```

En dörr vars verkliga takt avviker kraftigt från startgissningen behöver många sessioner för att
siffran ska hinna fram. Eftersom `measureQueueRates` bara ser **45 minuter** bakåt hinner antalet
sällan över 2–3 på en kväll. **I praktiken är det ofta `venue.pace` som styr vad användaren ser.**

### B-02 — `venue.pace` är en gissning utan ursprung

De 28 `pace`-värdena (`fast: 14`, `normal: 9`, `slow: 5`) är satta för hand. Det finns ingen
dokumentation av varför, inget sätt att se om de stämmer, och ingen automatik som justerar dem när
mätdata finns. Givet B-01 är detta **den enskilt mest inflytelserika odokumenterade siffran i
appen**.

### B-03 — Ingen åldersdegradering av statusfärgen

En rapport 44 minuter gammal ger exakt samma färg och samma text som en 2 minuter gammal. Åldern
syns bara som text ("44 min sedan"). Projektets egen princip säger att gammal data ska se gammal ut.

### B-04 — `source` visas inte konsekvent

`estimateWait` returnerar `source: 'live' | 'history' | 'estimate'`, men gränssnittet visar bara
"≈ uppskattning" i vissa vyer. En användare kan inte se skillnad på en siffra som vilar på kvällens
mätningar och en som vilar på en handsatt gissning.

### ~~B-05 — `limit(100)` kan tysta hastighetsmätningen~~ — åtgärdat

`loadReports` hämtade de 100 senaste icke-utgångna rapporterna, så en kö-sessions `initial` kunde
falla utanför en full kväll och sessionen försvinna ur `sessionRates` utan felmeddelande. Nu läses
upp till 1000 (PostgREST:s standardtak), vilket täcker alla icke-utgångna rapporter (≤45 min) med
marginal. Skulle `count` ändå överstiga det lästa skrivs en varning i konsolen.

### B-06 — Historiken använder ett osorterat urval

`loadHistoricalPatterns` frågar utan `limit` och utan `order`. PostgREST returnerar
högst 1000 rader, och vilka 1000 är inte definierat. Resultatet lagras i `_historicalPatterns`
men påverkar inte väntetiden — bara en indikator i Utforska. `loadHistoricalRates`, som **faktiskt**
påverkar väntetiden, sorterar däremot korrekt på `created_at desc`.

### ~~B-07 — Modellen har inga tester~~ — åtgärdat

Modellen har nu 111 enhetstester i `tests/`, körbara med `npm test`. Räkneexemplen i avsnitt 5 finns
som testfall i `tests/wait.test.js`. Se [TESTING.md](TESTING.md).

### ~~B-08 — "Ingen kö" blev en uppmätt dörrtakt på noll~~ — åtgärdat

`aheadBucket(0).width` är 0, så en session med 0 framför i båda ändar gav takten 0, och vakten
`rate !== null` släppte igenom den. Nåddes genom ett normalt flöde: "Ingen kö" → "Jag är inne" tolv
minuter senare.

Verifierad effekt före åtgärden, på Kristall med 37 framför:

| Nollsessioner i historiken | Appen visade |
|---|---|
| 0 | 10–25 min |
| 1 | 20–35 min |
| 2 | **"Fullt"** |

Åtgärdat med `&& aheadBucket(first.people_ahead).width > 0` i `sessionRates`. Verifierat i
webbläsare: Kristall visar nu 10–25 min, identiskt med ett kontrollställe med samma `pace` och samma
kölängd men utan nollsessioner. Hittades av det första testet som skrevs för `sessionRates`, och är
precis den klass av fel `scripts/check.js` aldrig kan upptäcka — koden såg korrekt ut, den räknade
fel.

---

## 10. Vad som är deterministiskt

| Del | Deterministisk? |
|---|---|
| `estimateWait`, `sessionRates`, `formatWait`, `waitToStatus`, `setWaitRange`, `aheadBucket`, `median` | **Ja** — rena funktioner, samma indata ger alltid samma utdata |
| `historicalRateFor`, `computeCalibration` | **Ja**, men kräver att tiden skickas in (vilket den kan) |
| `computeStatus`, `venueWaitText`, `forecastWait` | **Nej** — läser `Date.now()` och den globala `allReports` internt |
| Allt som visas | Beror på vilka 100 rapporter `loadReports` råkade hämta |

De rena funktionerna i första raden kan testas direkt i Node utan webbläsare, utan Supabase och
utan Mapbox. **Det är där tester ska börja.**
