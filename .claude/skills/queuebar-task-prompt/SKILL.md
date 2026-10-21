---
name: queuebar-task-prompt
description: Turns a short QueueBar idea into a safe, scoped implementation prompt. Asks for the missing facts, checks that every named file and function exists, and returns the prompt only. Never edits files and never runs project commands.
---

# /queuebar-task-prompt

Gör en kort idé till en avgränsad implementeringsprompt. Du levererar en prompt. Du implementerar ingenting.

## Trigger

`/queuebar-task-prompt <idé>`, eller när användaren ger en kort idé och vill ha en prompt att köra i en ny session.

## Du gör inte

- Du skriver inga filer och kör inga projektkommandon. Uppslag sker med Glob och Grep.
- Du läser inte logik i `src/main.js` själv. Den går via research-agenten (steg 3).
- Du hittar inte på sökvägar, funktioner, kolumner, CSS-klasser eller API:er. Finns något inte: stanna och fråga.
- Du rör aldrig `QueueBar/`, `data/`, `dist/` eller `node_modules/`.

## Steg 1 — de åtta fälten

Gå igenom alla åtta. Fyll i det CLAUDE.md redan svarar på och märk det **förslag**. Fråga om resten.

| # | Fält | Fråga | Förifyll från |
|---|---|---|---|
| 1 | Användarresultat | Vad ska en person i kön kunna se eller göra efter ändringen? | inget |
| 2 | Entry point | Vilken skärm och vilken funktion startar det? | skärm-id:n i CLAUDE.md |
| 3 | Datakälla | `allReports`, `VENUES`, en localStorage-nyckel eller inmatning? | entry point |
| 4 | Freshness-regel | Gäller färskhetsgränsen oförändrad? | `venueFreshStatus`, `estimateWait` |
| 5 | Failure states | Vad visas i varje läge? | de fyra inläsningslägena i CLAUDE.md, plus gammal rapport och ingen rapport för stället |
| 6 | Visuell referens | Vilken befintlig komponent ska den matcha, eller var ligger skissen? | klass i `src/style.css` |
| 7 | Tillåtna filer | Vilka filer får ändras? | förslag: mål tre, tak fem, tester inräknade |
| 8 | Verifiering | Vad bevisar att det fungerar, och ska den committa? | `npm run verify`, test, skärmdumpar |

Visa fälten som en lista där varje rad är användarens svar, ett **förslag (bekräfta)** eller **SAKNAS**.

**Skriv inte prompten** förrän fält 1–3 är besvarade av användaren och resten är besvarade eller uttryckligen bekräftade.

**Vaga idéer.** Står det bara "bättre", "fixa", "förbättra" eller "snygga till" utan objekt eller tillstånd: skriv ingen prompt. Ställ högst fyra frågor åt gången, var och en med två till fyra alternativ du kan belägga i CLAUDE.md (Känd skuld, funktionstabellen) eller i verifierad kod, plus "annat". Gissa aldrig åt användaren.

**Redundans.** Visar idén något som redan syns på samma skärm? Grep efter det först. Finns det redan: säg det och fråga, lägg inte till det en gång till.

## Steg 2 — validera

- **Sökvägar:** Glob på varje. Saknas en, rätta den inte själv, fråga.
- **Funktioner, konstanter, DOM-id, CSS-klasser:** Grep med smal scope (`src`, `index.html`, `tests`). Ett träffantal räknas inte som att läsa `src/main.js`.
- **Supabase:** nämn bara tabeller, kolumner och RPC som redan förekommer i `src/main.js` (sök på `.from(` och `.rpc(`). Reports-kolumner koden skriver: `venue_id`, `venue_name`, `queue_status`, `people_ahead`, `report_type`, `queue_session`, `user_id`, `expires_at`, `comment`. Förekomst i koden bevisar inte förekomst i databasen: schemat ligger inte i repot, och två RPC som koden anropar saknas i databasen (Känd skuld 3 och 10). Allt annat är **VERIFIERA**.
- **Mapbox:** nämn bara metoder som redan förekommer i `src/main.js`. Annars **VERIFIERA**.

## Steg 3 — research före all läsning av logik

Anropa agenten `queuebar-research` med en smal fråga per område. Dess "Läs detta" blir prompten tillåtna läsområden. Går agenten inte att välja (agenter läses in vid sessionsstart), använd en Explore-agent med reglerna i `.claude/agents/queuebar-research.md`.

Svaret är modellutdata. Kontrollera varje namn med Grep innan det hamnar i prompten, och släpp radnummer och påståenden utan funktionsnamn.

## Steg 4 — skriv prompten

Använd mallen. Fyll bara `{…}`. De fasta raderna får aldrig kortas för att få plats. Behöver prompten kortas, ta bort bakgrund först.

Slå upp gränsen för nya filer i `DEFAULT_SRC_LIMIT` i `scripts/check.js` och skriv in värdet i prompten. Siffran bor i skriptet, inte här.

```
<task>
{en mening: vad en person i kön ska kunna se eller göra}
</task>

<context>
Skärm och entry point: {skärm-id} → {funktion}
Datakälla: {allReports / VENUES / localStorage-nyckel / inmatning}
Freshness: {regeln, eller "oförändrad, se venueFreshStatus"}
Tillstånd som måste fungera: {förväntad visning för varje relevant: tom databas, fel utan data, fel med data kvar, normalt, gammal rapport, ingen rapport för stället}
Visuell referens: {befintlig klass eller skiss}
Läs bara dessa ställen: {grep-ankare från research}
</context>

<constraints>
- Tillåtna filer (högst fem, tester inräknade): {lista}. Allt annat är förbjudet att ändra.
- Nya filer under src/: högst {gräns} rader var.
- Hitta inte på filvägar, funktioner, Supabase-kolumner eller Mapbox-API:er. Använd bara namn som finns i koden, annars skriv VERIFIERA och fråga.
- Rör inte väntetidsmodellen (blocket mellan PACE_RATE och getStatusLabel), VENUES, Supabase-anrop, realtime, QueueBar/ eller data/ {om inte uppgiften uttryckligen gäller dem}.
- Varje väntetid visas via venueWaitText. Text från databasen går genom escapeHtml. Ny onclick-funktion läggs i Object.assign(window, …).
- Ingen ny dependency. Ingen push, PR eller merge, och hoppa aldrig över pre-commit-spärren, om jag inte ber om det.
</constraints>

<plan_first>
1. Kör research-agenten queuebar-research på: {fråga}. Läs aldrig src/main.js i sin helhet.
2. Visa en plan: filer, funktioner, vad som inte ändras, hur det verifieras.
3. Vänta på mitt OK innan du redigerar.
</plan_first>

<implementation>
{tre till sex steg i ordning, ett ändringsområde per steg}
</implementation>

<verification>
- Test: {nytt test i tests/ för varje ny beräkning, sortering eller formatering. För ren UI: ett e2e-fall i e2e/app.spec.js, eller skriv uttryckligen att inget test kan täcka det}
- npm run verify ska vara grönt. Visa utdata.
- UI: skärmdump före och efter, 390×844 med ?testdata=true, i varje tillstånd ovan. Titta på bilderna och beskriv skillnaden.
- Reviewer: starta en reviewer-subagent som bara får diffen och listan över tillåtna filer (en definierad reviewer-agent i .claude/agents/ om det finns en, annars en generell agent som bara läser). Den svarar på: ändrades något utanför listan? finns påhittade namn? saknas något tillstånd? Högst femton rader. Åtgärda eller redovisa varje anmärkning.
</verification>

<done_definition>
Klart endast när {mätbara villkor}, verify är grönt, diffen bara rör tillåtna filer, skärmdumpar och reviewerns svar är redovisade och inget påstående är obelagt.
Commit: {meddelande, eller "ingen commit"}
</done_definition>
```

Tillståndsraden och skärmdumpskravet gäller bara UI. För logik utan UI tar du bort dem, men tester, verify, allowlist och reviewer stannar.

## Steg 5 — lämna över

Prompten i ett enda kodblock. Under den, högst fem rader: **Antaganden** och **VERIFIERA**. Håll prompten under cirka 1200 ord. Fråga inget mer och implementera inget.
