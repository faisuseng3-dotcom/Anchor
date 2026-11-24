# Qbar i App Store

Allt som går att göra utan Apple Developer Program är klart. Kvar är bara stegen som kräver kontot (99 USD/år).
Texterna nedan klistras in i App Store Connect som de står.

## När kontot finns

1. Gå med i Apple Developer Program som privatperson (developer.apple.com/programs). Godkännandet tar ofta ett dygn.
2. Xcode → Settings → Accounts → lägg till ditt Apple-ID.
3. `cd ~/Desktop/fm-wt && npm run ios` (bygger, synkar och öppnar Xcode).
4. Klicka **App** i listan till vänster → **Signing & Capabilities** → välj ditt team under **Team**.
   Bundle-id `se.qbar.app` (registrerat för hand under developer.apple.com → Identifiers).
5. App Store Connect → Appar → **+** → Ny app: iOS, namn enligt nedan, primärt språk **svenska**,
   bundle-id `se.qbar.app`, SKU `qbar`.
6. I Xcode: välj **Any iOS Device (arm64)** som mål → **Product → Archive** → **Distribute App → App Store Connect**.
7. Fyll i App Store Connect med avsnitten nedan, ladda upp bilderna i `store/screenshots/`, välj bygget och skicka in.
8. Under **Pris och tillgänglighet**: avmarkera **Tillgänglig på Mac** (appen är byggd för iPhone i stående läge).

Version 1.0, bygge 1. Laddas ett nytt bygge upp för samma version måste byggnumret höjas
(`CURRENT_PROJECT_VERSION` i Xcode, fliken General → Build).

## Butikstexter (svenska)

**Namn** (högst 30 tecken): `Qbar: Köer i Stockholm`

**Underrubrik** (högst 30): `Se kön innan du går dit`

**Kampanjtext** (högst 170):
Hur lång är kön? Qbar visar vad andra besökare rapporterat de senaste 45 minuterna på över 280 barer, pubar och klubbar i Stockholm. Gratis, utan konto.

**Beskrivning:**
```
Qbar visar hur lång kön är på barer, pubar och nattklubbar i Stockholm, enligt rapporter från folk som står i dem.

Två tryck räcker: välj stället och hur många som står framför dig. När tre personer rapporterat samma kö räknar Qbar om det till en uppskattad väntetid. Innan dess ser du vad som rapporterats.

• Karta och lista över fler än 280 ställen i Stockholm
• Rapporter från de senaste 45 minuterna, med hur gamla de är
• Uppskattad väntetid när tre personer är överens
• "Bäst nu": där du troligen kommer in snabbast, räknat med promenaden dit
• Flöde med de senaste rapporterna i stan
• Stängningstider där de är kända
• Vägbeskrivning till fots

Bra att veta: köerna är uppskattningar från andra besökare och kan vara fel. Qbar lovar inte insläpp eller väntetid; vakten bestämmer alltid. Öppettider kommer från OpenStreetMap och ställenas egna sidor. Kvällar med få rapporter säger appen det.

Inga konton, ingen reklam. Din exakta position lämnar aldrig telefonen; med en rapport sparas bara om du var vid stället. Allt du skickat kan raderas under Profil.

Qbar är för dig som fyllt 18 år.
```

**Nyckelord** (högst 100, inga mellanslag):
`kö,krog,bar,nattklubb,klubb,utgång,nattliv,uteliv,stureplan,södermalm,väntetid,insläpp,fest,pub`

**Support-URL:** `https://qbar-app.vercel.app/support.html` (vanliga frågor och kontaktadressen qbar.info1@gmail.com)

**Marknadsförings-URL:** `https://qbar-app.vercel.app`

**Integritetspolicy-URL:** `https://qbar-app.vercel.app/integritet.html`

**Kategori:** Mat och dryck (primär), Livsstil (sekundär). Inte Navigering: vägen öppnas i Google Maps

**Copyright:** `2026 Fais Useng`

## Skärmbilder

`store/screenshots/` innehåller fem bilder i 1320×2868 (6,9 tum, det format App Store kräver; mindre storlekar skalas
från dem): karta, lista, utfällt ställe, Live, Rapportera. `npm run build && node scripts/screenshots.mjs` tar dem ur
appens testdata (fredag 23:00, utan servern), med testdatans 17 ställen omdöpta till påhittade namn (en butiksbild får
inte visa påhittade köer på riktiga krogar) och etiketten "Exempeldata" på varje bild. Ta om dem när utseendet ändras.

## Åldersgräns

Svara i frågeformuläret:
- Alkohol, tobak eller droger, referenser: **Ofta/intensivt** (appen handlar om barer och nattklubbar)
- Allt annat: **Nej/Ingen**
- Obegränsad webbåtkomst: **Nej** (externa länkar öppnas i Safari eller Google Maps, inte i appen)
- Användargenererat innehåll: **Ja**. Kö-rapporterna är antal och tid; "Från stället" är ställets egen fri text (bara
  ställen med avtal, inloggade på krog.html). Allt går att anmäla i appen ("Fel uppgift? Anmäl" i ställets kort, e-post till
  qbar.info1@gmail.com), och falska rapporter tas bort för hand

Välj sedan manuellt **18+**: villkoren i `integritet.html` säger att Qbar är för den som fyllt 18.

## Appens integritet (App Privacy)

Ingen spårning (Tracking: **Nej**). Det finns inga konton, men rapporterna bär ett beständigt slumpat id per
installation, och Apple räknar data med ett beständigt id som kopplad till användaren.

| Datatyp | Insamlas | Syfte | Kopplad till dig | Spårning |
|---|---|---|---|---|
| Användarinnehåll → Övrigt användarinnehåll (kö-rapporter: antal, tid, ställe; "Jag ska dit": ställe, ankomsttid) | Ja | Appens funktion | Ja | Nej |
| Identifierare → Användar-id (slumpat id per installation, nyckeln till Radera min data) | Ja | Appens funktion | Ja | Nej |
| Plats → Ungefärlig plats (om du var inom 300 m från stället när du rapporterade, ja/nej) | Ja | Appens funktion | Ja | Nej |
| Användningsdata → Produktinteraktion (Mapbox räknar kartladdningar) | Ja | Analys (tredje part) | Nej | Nej |
| Identifierare → Enhets-id (Mapbox: slumpat id i kartans kartladdningshändelser, för Mapbox fakturering) | Ja | Analys (tredje part) | Nej | Nej |

Exakt position skickas aldrig.

## Innehållsrättigheter

"Innehåller appen innehåll från tredje part?" **Ja**: kartor från Mapbox och ställen från OpenStreetMap (ODbL).
Båda krediteras i kartan (© Mapbox © OpenStreetMap) och OpenStreetMap även under Profil → Källor.

## Exportregler för kryptering

Redan besvarat i appen (`ITSAppUsesNonExemptEncryption = false` i `Info.plist`): bara HTTPS, ingen egen kryptering.
Frågan kommer inte upp.

## Inloggning för granskning

Ingen inloggning krävs. Lämna "Logga in krävs" avmarkerat.

## Anteckningar till granskaren (engelska)

```
Qbar shows user-submitted queue reports (up to 45 minutes old) for over 280 bars and nightclubs in Stockholm,
Sweden. Wait times are estimates and are only shown in minutes when three people agree. No account and no login.

Outside Stockholm nightlife hours (Thu-Sat 22-03) there are usually no reports. To see the app with sample data
without sending anything: tap the profile button (top right on the map) > "Så funkar Qbar". This runs a short tour
on sample data, clearly labelled "Exempel".

Native features:
- Location (when in use): walking distance and time to each venue, and whether you are at the venue you report.
  The exact position never leaves the device; only a yes/no "at venue" flag is stored with a report.
- Local notifications: after you report a queue you are standing in, the app reminds you after 5 minutes to update
  how many people are ahead of you. This needs a real report, so it does not appear in the tour.

Delete my data: Profil > Radera min data removes all reports and data tied to the device's random id.
Wrong or abusive information: every venue with reports has "Fel uppgift? Anmäl" (report a problem), which emails us;
false reports are removed by hand.
Support: qbar.info1@gmail.com
```

## Kända risker vid granskningen

- **Regel 4.2 (minsta funktionalitet):** Apple nekar ibland appar som mest är en webbsida i ett skal. Qbar har inbyggd
  plats och lokala påminnelser och fungerar utan inloggning, men risken finns. Nekas den: svara att appen använder
  platstjänster och lokala notiser och är byggd för att användas i kön, på plats.
- **Tomma vyer:** granskas appen en vardag förmiddag finns inga rapporter. Därför rundturen i anteckningarna ovan.
