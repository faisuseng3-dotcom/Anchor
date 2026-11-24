// App Store-bilderna i store/screenshots/ (1320×2868, 6,9 tum). Kör efter `npm run build`: node scripts/screenshots.mjs
// Appens testdata (?testdata=true), fredag 23:00, utan servern. Testdatans 17 ställen byter namn mot påhittade: en
// butiksbild får inte visa påhittade köer på riktiga krogar. Namnen gav inga träffar på barer, klubbar eller
// restauranger i Stockholm vid en sökning 2026-11-24 (de fyra första även 2026-11-05, qbar-ad). Etiketten "Exempeldata"
// syns på varje bild.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const NAMES = {
  'patricia': 'Söderklubben', 'sturehof': 'Östermalmsbaren', 'berns': 'Sveaklubben', 'hells-kitchen': 'Fyrlyktan',
  'kristall': 'Glödlampan', 'soap-bar': 'Vindsgluggen', 'under-bron': 'Måsboet', 'nalen': 'Tegelhallen',
  'spy-bar': 'Silverskeden', 'morfar-ginko': 'Blåklinten', 'akkurat': 'Ankarlänken', 'tak': 'Lövsalen',
  'tjoget': 'Tranbäret', 'neu': 'Stjärnkikaren', 'pharmarium': 'Snäckskalet', 'sturecompagniet': 'Pärlporten',
  'pelikan': 'Klockstapeln'
};
const OUT = 'store/screenshots';

const server = await preview({ preview: { port: 4174, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({
  viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'sv-SE',
  timezoneId: 'Europe/Stockholm'
});
await page.clock.setFixedTime(new Date('2026-11-27T23:00:00+01:00'));
// Inga riktiga rapporter blandas in, och inget skickas.
await page.route('**/*.supabase.co/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '[]',
  headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/0' }
}));
await page.addInitScript((names) => {
  localStorage.setItem('qb_consent', 'true');
  localStorage.setItem('qb_tour_done', '1');
  localStorage.setItem('qb_onboarding_done', 'true');
  localStorage.setItem('qb_install_dismissed', '1');
  sessionStorage.setItem('qb_splash', '1');
  // VENUES är modulintern: byt namnen första gången appen använder listan (den array vars ställen har stängningstid och
  // takt), och återställ sedan Array-metoderna. Samma grepp som qbar-ad/scripts/app-page.mjs.
  const methods = ['map', 'find', 'filter', 'forEach', 'slice', 'some'];
  const orig = Object.fromEntries(methods.map((m) => [m, Array.prototype[m]]));
  for (const m of methods)
    Array.prototype[m] = function (...a) {
      if (this[0]?.closing !== undefined && this[0]?.pace) {
        for (const k of methods) Array.prototype[k] = orig[k];
        for (const v of this) if (names[v.id]) v.name = names[v.id];
      }
      return orig[m].apply(this, a);
    };
}, NAMES);

await page.goto('http://localhost:4174/?testdata=true', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: ".qb-testdata body::after { content: 'Exempeldata' !important; font-size: calc(15 * var(--u)) !important; }" });
if (await page.evaluate(() => getVenueById('tjoget').name) !== NAMES.tjoget) throw new Error('Namnen byttes inte: har VENUES ändrats?');
await page.waitForTimeout(6000); // kartan och pillarnas intoning

const REAL = ['Patricia', 'Sturehof', 'Berns', "Hell's Kitchen", 'Kristall', 'Soap Bar', 'Under Bron', 'Nalen', 'Spy Bar',
  'Morfar Ginko', 'Akkurat', 'TAK Stockholm', 'Tjoget', 'Neu', 'Pharmarium', 'Sturecompagniet', 'Pelikan'];
async function shot(file) {
  await page.waitForTimeout(1500);
  // Riktiga ställen utan rapporter får synas; testdatans riktiga namn får inte det.
  const text = await page.evaluate(() => document.querySelector('.screen.active').innerText);
  const leaked = REAL.filter((n) => new RegExp('(^|\\n)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\n|$)').test(text));
  if (leaked.length) throw new Error(file + ': riktiga namn syns: ' + leaked.join(', '));
  await page.screenshot({ path: OUT + '/' + file });
  console.log(file);
}

mkdirSync(OUT, { recursive: true });
await shot('1-karta.png');
await page.evaluate(() => showScreen('explore'));
await shot('2-lista.png');
await page.click('#explore-list .erow');
await shot('3-stalle.png');
await page.evaluate(() => showScreen('live'));
await shot('4-live.png');
await page.evaluate(() => showScreen('report'));
await shot('5-rapportera.png');

await browser.close();
await server.close();
