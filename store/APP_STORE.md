# Qbar i App Store

Allt som går att göra utan Apple Developer Program är klart. Kvar är bara stegen som kräver kontot (99 USD/år).
Texterna nedan klistras in i App Store Connect som de står.

## När kontot finns

1. Gå med i Apple Developer Program som privatperson (developer.apple.com/programs). Godkännandet tar ofta ett dygn.
2. Xcode → Settings → Accounts → lägg till ditt Apple-ID.
3. `cd ~/Desktop/fm-wt && npm run ios` (bygger, synkar och öppnar Xcode).
4. Klicka **App** i listan till vänster → **Signing & Capabilities** → välj ditt team under **Team**.
   Bundle-id `se.queuebar.qbar` registreras automatiskt.
5. App Store Connect → Appar → **+** → Ny app: iOS, namn enligt nedan, primärt språk **svenska**,
   bundle-id `se.queuebar.qbar`, SKU `qbar`.
6. I Xcode: välj **Any iOS Device (arm64)** som mål → **Product → Archive** → **Distribute App → App Store Connect**.
7. Fyll i App Store Connect med avsnitten nedan, ladda upp bilderna i `store/screenshots/`, välj bygget och skicka in.
8. Under **Pris och tillgänglighet**: avmarkera **Tillgänglig på Mac** (appen är byggd för iPhone i stående läge).

Version 1.0, bygge 1. Laddas ett nytt bygge upp för samma version måste byggnumret höjas
(`CURRENT_PROJECT_VERSION` i Xcode, fliken General → Build).

## Butikstexter (svenska)

**Namn** (högst 30 tecken): `Qbar: Köer i Stockholm`

**Underrubrik** (högst 30): `Se kön innan du går dit`

**Kampanjtext** (högst 170):
Hur lång är kön just nu? Qbar visar väntetiden på 290 barer och klubbar i Stockholm, rapporterad av folk som står där. Hitta kortast kö på några sekunder.

**Beskrivning:**
```
Qbar visar hur lång kön är på barer, pubar och nattklubbar i Stockholm, just nu.

Köerna rapporteras av folk som står i dem. Två tryck räcker: välj stället och hur många som står framför dig. Qbar räknar om det till en väntetid och visar den för alla.

• Karta och lista över 290 ställen, från Stureplan till Södermalm
• Väntetid i minuter när tre personer rapporterat samma kö; innan dess ser du vad de rapporterat, i lila
• "Bäst nu": stället där du kommer in snabbast, räknat med promenaden dit
• Live: de senaste rapporterna från hela stan
• Gammal data ser gammal ut, och saknas data säger appen det
• Stängda ställen visas som stängda
• Vägbeskrivning till fots

Inga konton, ingen reklam. Din position lämnar aldrig telefonen. Allt du skickat kan raderas under Profil.
```

**Nyckelord** (högst 100, inga mellanslag):
`kö,krog,bar,nattklubb,klubb,utgång,nattliv,uteliv,stureplan,södermalm,väntetid,insläpp,vakt,fest`

**Support-URL:** `https://anchor-queuebar.vercel.app/integritet.html` (har kontaktadressen support@queuebar.se)

**Marknadsförings-URL:** `https://anchor-queuebar.vercel.app`

**Integritetspolicy-URL:** `https://anchor-queuebar.vercel.app/integritet.html`

**Kategori:** Mat och dryck (primär), Navigering (sekundär)

**Copyright:** `2026 Qbar`

## Skärmbilder

`store/screenshots/` innehåller fem bilder i 1320×2868 (6,9 tum, det format App Store kräver; mindre storlekar skalas
från dem): karta, lista, utfällt ställe, Live, Rapportera. Tagna ur appen med dess testdata en fredag kl. 23, utan
testlägets etikett (Playwright mot `vite preview`, 440×956 punkter, skala 3). Ta om dem när utseendet ändras.

## Åldersgräns

Svara i frågeformuläret:
- Alkohol, tobak eller droger, referenser: **Sällan/milt** (ställena är barer och klubbar; appen visar inget drickande)
- Allt annat: **Nej/Ingen**
- Obegränsad webbåtkomst: **Nej** (externa länkar öppnas i Safari eller Google Maps, inte i appen)
- Användargenererat innehåll: kö-rapporterna är bara antal och tid, ingen fri text

Vill du följa klubbarnas åldersgränser kan du välja en högre gräns än den Apple räknar fram.

## Appens integritet (App Privacy)

Ingen spårning (Tracking: **Nej**). Inget av det nedan är kopplat till användarens identitet: det finns inga konton,
bara ett slumpat id per installation.

| Datatyp | Insamlas | Syfte | Kopplad till dig | Spårning |
|---|---|---|---|---|
| Användarinnehåll → Övrigt användarinnehåll (kö-rapporter: antal, tid, ställe) | Ja | Appens funktion | Nej | Nej |
| Identifierare → Användar-id (slumpat id per installation, nyckeln till Radera min data) | Ja | Appens funktion | Nej | Nej |
| Plats → Ungefärlig plats (om du var inom 300 m från stället när du rapporterade, ja/nej) | Ja | Appens funktion | Nej | Nej |
| Användningsdata → Produktinteraktion (Mapbox räknar kartladdningar) | Ja | Analys (tredje part) | Nej | Nej |

Exakt position skickas aldrig. "På väg" sparar ställe och beräknad ankomsttid på servern; det räknas som
användarinnehåll ovan.

## Innehållsrättigheter

"Innehåller appen innehåll från tredje part?" **Ja**: kartor från Mapbox och ställen från OpenStreetMap (ODbL).
Båda krediteras i kartan (© Mapbox © OpenStreetMap), vilket licenserna kräver.

## Exportregler för kryptering

Redan besvarat i appen (`ITSAppUsesNonExemptEncryption = false` i `Info.plist`): bara HTTPS, ingen egen kryptering.
Frågan kommer inte upp.

## Inloggning för granskning

Ingen inloggning krävs. Lämna "Logga in krävs" avmarkerat.

## Anteckningar till granskaren (engelska)

```
Qbar shows live queue lengths at 290 bars and nightclubs in Stockholm, Sweden. All data is reported by users standing
in the queues; there is no account and no login.

Outside Stockholm nightlife hours there may be no live reports, so most venues will show no data. To see the app with
sample data:
1. Tap the profile button (top right on the map) to open the "Profil" screen.
2. Tap the heading "Profil" five times quickly.
The app reloads with sample reports for 17 venues and shows the label "Testdata · inget skickas" ("Test data, nothing is
sent") at the bottom. Nothing is sent to the server in this mode. Tap the heading five times again to turn it off.

Native features:
- Location (when in use): walking distance and time to each venue, and whether you are at the venue you report.
  The position never leaves the device.
- Local notifications: after you report a queue you are standing in, the app reminds you after 5 minutes to update
  how many people are ahead of you. This needs a real report, so it does not appear in sample-data mode.

Delete my data: Profil > Radera min data removes all reports and data tied to the device's random id.
```

## Kända risker vid granskningen

- **Regel 4.2 (minsta funktionalitet):** Apple nekar ibland appar som mest är en webbsida i ett skal. Qbar har inbyggd
  plats och lokala påminnelser och fungerar utan inloggning, men risken finns. Nekas den: svara att appen använder
  platstjänster och lokala notiser och är byggd för att användas i kön, på plats.
- **Tomma vyer:** granskas appen en vardag förmiddag finns inga rapporter. Därför testdatan i anteckningarna ovan.
