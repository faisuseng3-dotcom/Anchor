// De fyra flödena som enhetstesterna inte kan nå, eftersom de renderar DOM.
// Allt mot mockad Supabase — inget test rör produktionsdatabasen.

import { test, expect } from '@playwright/test';
import { report, mockSupabase, skipOnboarding, openApp, goToScreen, E2E_NOW } from './support.js';
// Synliga ställen i VENUES (låst i tests/venues.test.js). Harnessen går inte att importera här: Playwright laddar den som CJS.
const ALLA = 293;

// En kväll med tre ställen som har rapporter.
const KVALL = [
  report('kristall', 3, 37, { venueName: 'Kristall' }),
  report('spy-bar', 6, 5, { venueName: 'Spy Bar' }),
  report('berns', 12, 17, { venueName: 'Berns' })
];

test.describe('1. Appen startar och Utforska renderar', () => {
  test('alla ställen listas, de med data visar en väntetid', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    const errors = await openApp(page);
    await goToScreen(page, 'explore');

    await expect(page.locator('.erow')).toHaveCount(ALLA);

    // Färskhetsraden ska redovisa hur mycket som faktiskt är färskt.
    // Tre ställen har rapporter; nämnaren är de öppna klockan 23 (E2E_NOW), och då har några barer stängt.
    await expect(page.locator('#exsum-line')).toContainText(/^3 av \d+ öppna ställen har färsk rapport/);

    // Ett ställe med rapport visar ett intervall, aldrig en naken siffra. En person räcker inte för minuter: då visas
    // det hon rapporterade ("25–50 i kö").
    const kristall = page.locator('.erow', { hasText: 'Kristall' }).first();
    await expect(kristall.locator('.erow-hero')).toHaveText(/min|Fullt|Ingen kö|i kö$/);

    expect(errors, 'inga JS-fel vid start').toEqual([]);
  });

  test('ett ställe utan rapporter säger att data saknas — det gömmer sig inte', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);
    await goToScreen(page, 'explore');

    // Saknad data sägs av rubriken över gruppen och av strecket i stället för en väntetid, inte av samma mening på
    // varje rad.
    await expect(page.locator('.list-section')).toHaveText('Utan färsk rapport');
    const utanData = page.locator('.erow', { hasText: 'Tjoget' }).first();
    await expect(utanData.locator('.erow-hero')).toHaveText('–');
    await expect(utanData).not.toContainText(/min/);
  });
});

test.describe('2. Serverfel visas som fel, inte som en tyst kväll', () => {
  test('utan data: alla tre vyerna säger att kontakten saknas', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, 'error');
    await openApp(page);
    await goToScreen(page, 'explore');

    // Det här är buggen testet finns för: tidigare stod här
    // "Inga rapporter än — bli först att rapportera", ord för ord som när det är tomt.
    const linje = page.locator('#exsum-line');
    await expect(linje).toContainText('Ingen kontakt med servern');
    await expect(linje).not.toContainText('Inga rapporter');
    await expect(linje).toHaveClass(/exsum-line--error/);

    await expect(page.locator('.explore-error-state')).toBeVisible();

    await goToScreen(page, 'live');
    await expect(page.locator('.lv-empty-title')).toContainText('Ingen kontakt med servern');
  });

  test('tom databas säger något HELT annat än ett serverfel', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, []);
    await openApp(page);
    await goToScreen(page, 'explore');

    const linje = page.locator('#exsum-line');
    await expect(linje).toContainText('Inga rapporter än');
    await expect(linje).not.toContainText('Ingen kontakt');
    await expect(linje).not.toHaveClass(/exsum-line--error/);
    // Inget felläge: databasen svarade, den var bara tom.
    await expect(page.locator('.explore-error-state')).toHaveCount(0);
  });

  test('fel efter lyckad läsning behåller datan och varnar', async ({ page }) => {
    await skipOnboarding(page);
    // Första läsningen lyckas, därefter faller servern.
    let n = 0;
    await page.route('**/*.supabase.co/rest/**', (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes('on_my_way')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      n += 1;
      if (n === 1) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          headers: { 'content-range': '0-2/3' }, body: JSON.stringify(KVALL)
        });
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"nere"}' });
    });
    await page.route('**/*.mapbox.com/**', (route) => route.abort());
    await openApp(page);

    // Pollningen går var 30 s — framkalla den andra läsningen direkt.
    await page.evaluate(() => window.loadReports());
    await page.waitForTimeout(1200);
    await goToScreen(page, 'explore');

    await expect(page.locator('#exsum-line')).toContainText('siffrorna kan vara gamla');
    // Datan kastas INTE bort för att en pollning missade.
    await expect(page.locator('.erow')).toHaveCount(ALLA);
    await expect(page.locator('.explore-error-state')).toHaveCount(0);
  });

  test('felet går över av sig självt när nätet är tillbaka', async ({ page }) => {
    // Telefonen väcks innan nätet är uppe: läsningen misslyckas. Förut stod "Ingen kontakt" kvar i upp till två minuter.
    await skipOnboarding(page);
    let nere = true;
    await page.route('**/*.supabase.co/rest/**', (route) => {
      const url = decodeURIComponent(route.request().url());
      if (nere && !url.includes('on_my_way')) return route.abort('internetdisconnected');
      return route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'content-range': '0-2/3', 'access-control-expose-headers': 'content-range' }, body: url.includes('on_my_way') ? '[]' : JSON.stringify(KVALL)
      });
    });
    await page.route('**/*.mapbox.com/**', (route) => route.abort());
    await openApp(page);
    await expect(page.locator('#err-toast')).toHaveClass(/visible/, { timeout: 15000 });

    nere = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#err-toast')).not.toHaveClass(/visible/);
  });

  test('telefonens klocka går fel: en färsk rapport räknas ändå som färsk', async ({ page }) => {
    // Telefonen går 10 min efter. Utan serverns tid såg en rapport från för 2 min sedan ut att komma från framtiden
    // och räknades inte alls.
    await skipOnboarding(page);
    const rows = [report('kristall', 2, 17)];
    await page.route('**/*.supabase.co/rest/**', (route) => {
      const url = decodeURIComponent(route.request().url());
      return route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { date: new Date(E2E_NOW).toUTCString(), 'content-range': '0-0/1', 'access-control-expose-headers': 'content-range, date' },
        body: url.includes('/reports') && url.includes('expires_at') ? JSON.stringify(rows) : '[]'
      });
    });
    await page.route('**/*.mapbox.com/**', (route) => route.abort());
    await page.clock.setFixedTime(E2E_NOW - 10 * 60 * 1000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.showScreen === 'function', { timeout: 15000 });
    await page.waitForTimeout(2500);
    await goToScreen(page, 'explore');
    const rad = page.locator('#explore-list .erow[data-venue="kristall"]');
    await expect(rad).not.toHaveClass(/erow--empty/);
    await expect(rad).toContainText('2 min sedan');
  });
});

test.describe('3. Sök och öppna ett ställe', () => {
  test('sökning filtrerar och ett träffat ställe kan öppnas', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);
    await goToScreen(page, 'explore');

    const sok = page.locator('#screen-explore input').first();
    // "spy" ensamt matchar också "Tyska Brinken" (luddig sökning), så frågan är hela namnet.
    await sok.fill('spy bar');
    await page.waitForTimeout(600);

    const rader = page.locator('.erow');
    await expect(rader).toHaveCount(1);
    await expect(rader.first()).toContainText('Spy Bar');

    // Raden fälls ut på plats: kortet ligger direkt under raden, med vad väntetiden bygger på och huvudknappen.
    // Ingen ruta ovanpå listan. Ett tryck till fäller ihop raden.
    await rader.first().click();
    await expect(rader.first()).toHaveAttribute('aria-expanded', 'true');
    const kort = page.locator('.erow + #venue-card');
    await expect(kort).toBeVisible();
    await expect(kort.locator('#vc-sub')).toContainText(/senast (nyss|\d+ min sedan)/); // kortet säger hur gammal siffran är
    await expect(kort.locator('#vc-act-primary')).toBeVisible();
    await rader.first().click();
    await expect(rader.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#venue-card')).toBeHidden();
  });

  test('en sökning utan träff säger det, i stället för att visa en tom lista', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);
    await goToScreen(page, 'explore');

    await page.locator('#screen-explore input').first().fill('qqqzzz');
    await page.waitForTimeout(600);
    await expect(page.locator('.erow')).toHaveCount(0);
    await expect(page.locator('#screen-explore')).toContainText(/qqqzzz|Inga träffar|Hittade inget/i);
  });
});

test.describe('4. Rapportera en kö', () => {
  test('tre steg skickar en rapport med rätt fält', async ({ page }) => {
    await skipOnboarding(page);
    const inserts = [];
    await mockSupabase(page, [], { onInsert: (row) => inserts.push(row) });
    await openApp(page);
    await goToScreen(page, 'report');

    // Steg 1: välj ställe
    await page.locator('#rs-search').fill('kristall');
    await page.waitForTimeout(500);
    await page.locator('.rs-item').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('#rs-vname')).toContainText('Kristall');

    // Steg 2: välj antal framför
    await page.locator('#rs2 .q-btn').nth(2).click();
    await page.waitForTimeout(1500);

    // En rapport ska ha skickats, med de fält modellen behöver.
    expect(inserts.length, 'exakt en rapport skickad').toBe(1);
    const rad = inserts[0];
    expect(rad.venue_id).toBe('kristall');
    expect(typeof rad.people_ahead).toBe('number');
    expect(rad.report_type).toBe('initial');
    expect(rad.queue_session, 'kö-sessionen binder ihop uppföljningarna').toBeTruthy();
    expect(rad.expires_at, 'rapporten löper ut').toBeTruthy();

    // Steg 3: bekräftelsen syns
    await expect(page.locator('#rs3')).toBeVisible();
  });

  test('people_ahead är ett av intervallens mittvärden, inte ett löst tal', async ({ page }) => {
    await skipOnboarding(page);
    const inserts = [];
    await mockSupabase(page, [], { onInsert: (row) => inserts.push(row) });
    await openApp(page);
    await goToScreen(page, 'report');

    await page.locator('#rs-search').fill('berns');
    await page.waitForTimeout(500);
    await page.locator('.rs-item').first().click();
    await page.waitForTimeout(400);
    await page.locator('#rs2 .q-btn').first().click();
    await page.waitForTimeout(1500);

    expect(inserts).toHaveLength(1);
    expect([0, 5, 17, 37, 60]).toContain(inserts[0].people_ahead);
  });

  test('"Kom inte in" avslutar kön och skickas som en mätpunkt vid dörren', async ({ page }) => {
    // Förut stängde krysset kön utan att skicka något: appen lärde sig bara av dem som kom in.
    await skipOnboarding(page);
    const inserts = [];
    await mockSupabase(page, [], { onInsert: (row) => inserts.push(row) });
    await openApp(page);
    await goToScreen(page, 'report');
    await page.locator('#rs-search').fill('kristall');
    await page.waitForTimeout(500);
    await page.locator('.rs-item').first().click();
    await page.waitForTimeout(400);
    await page.locator('#rs2 .q-btn').nth(2).click();
    await page.waitForTimeout(1500);

    const banner = page.locator('#omw-banner');
    await expect(banner).toContainText('I kön');
    await banner.locator('.qs-close').click();
    await expect(banner).toContainText('Varför lämnar du kön?');
    await banner.getByRole('button', { name: 'Kom inte in' }).click();
    await page.waitForTimeout(800);

    expect(inserts).toHaveLength(2);
    expect(inserts[1].report_type).toBe('refused');
    expect(inserts[1].people_ahead, 'nådde dörren').toBe(0);
    expect(inserts[1].queue_session).toBe(inserts[0].queue_session);
    await expect(banner).toBeHidden();
  });

  test('utan täckning sparas rapporten och skickas när nätet kommer tillbaka', async ({ page }) => {
    // Källarklubb: första försöket når inte fram. Förut stod bara "Något gick fel" och rapporten var borta.
    await skipOnboarding(page);
    const inserts = [];
    let tackning = false;
    await mockSupabase(page, [], { onInsert: (row) => inserts.push(row) });
    await page.route('**/*.supabase.co/rest/v1/reports**', (route) => {
      if (route.request().method() === 'POST' && !tackning) return route.abort('internetdisconnected');
      return route.fallback();
    });
    await openApp(page);
    await goToScreen(page, 'report');
    await page.locator('#rs-search').fill('kristall');
    await page.waitForTimeout(500);
    await page.locator('.rs-item').first().click();
    await page.waitForTimeout(400);
    await page.locator('#rs2 .q-btn').nth(2).click();
    await expect(page.locator('.toast').last()).toContainText('Ingen täckning');
    expect(inserts).toHaveLength(0);

    tackning = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.toast').last()).toContainText('är skickad');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].venue_id).toBe('kristall');
  });

  test('byter man flik medan rapporten skickas och nätet går ner, sparas den ändå', async ({ page }) => {
    // Förut nollade flikbytet det valda stället, felvägen kraschade på selectedRV.id och rapporten försvann tyst.
    await skipOnboarding(page);
    const fel = [];
    page.on('pageerror', (e) => fel.push(e.message));
    await mockSupabase(page, []);
    let slapp;
    const vantar = new Promise((r) => { slapp = r; });
    await page.route('**/*.supabase.co/rest/v1/reports**', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await vantar;
      return route.abort('internetdisconnected');
    });
    await openApp(page);
    await goToScreen(page, 'report');
    await page.locator('#rs-search').fill('kristall');
    await page.waitForTimeout(500);
    await page.locator('.rs-item').first().click();
    await page.waitForTimeout(400);
    await page.locator('#rs2 .q-btn').nth(2).click();
    await goToScreen(page, 'explore');
    await goToScreen(page, 'report');
    slapp();
    await expect(page.locator('.toast').last()).toContainText('Ingen täckning');
    const sparad = await page.evaluate(() => JSON.parse(localStorage.getItem('qb_pending_report') || 'null'));
    expect(sparad && sparad.venueId).toBe('kristall');
    expect(fel).toEqual([]);
  });
});

test.describe('5. Radera min data', () => {
  // Raderingen är ett anrop, delete_my_data. Mocken svarar 200 på alla RPC:er; `fel` gör just det anropet till ett 500.
  async function raderaViaProfilen(page, fel) {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    let anrop = null;
    await page.route('**/rpc/delete_my_data', (route) => {
      anrop = JSON.parse(route.request().postData() || 'null');
      return fel
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"e2e"}' })
        : route.fulfill({ status: 204, body: '' });
    });
    await openApp(page);
    const id = 'u-e2e-radera-0123456789abcdef';
    await page.evaluate((v) => window.localStorage.setItem('qb_user_id', v), id);
    page.once('dialog', (d) => d.accept());
    await goToScreen(page, 'profile');
    await page.getByRole('button', { name: /Radera min data/ }).click();
    return { id, anrop: () => anrop };
  }

  test('ett serverfel ger fel, och id:t sparas så att det går att försöka igen', async ({ page }) => {
    const { id } = await raderaViaProfilen(page, true);
    await expect(page.locator('.toast')).toContainText('Kunde inte radera');
    expect(await page.evaluate(() => window.localStorage.getItem('qb_user_id'))).toBe(id);
  });

  test('raderingen skickar ditt id och rensar sedan den lokala datan', async ({ page }) => {
    const { id, anrop } = await raderaViaProfilen(page, false);
    // Sidan laddas om efter raderingen; en läsning mitt i omladdningen räknas som "inte klar än".
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('qb_user_id')).catch(() => id)).not.toBe(id);
    expect(anrop()).toEqual({ p_user_id: id });
  });
});

test.describe('Kartan', () => {
  test('visar ett felläge när Mapbox inte går att nå, och resten lever vidare', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);

    await expect(page.locator('.map-error-inner')).toContainText('Kartan kunde inte laddas');
    // Resten av appen ska fortfarande fungera.
    await goToScreen(page, 'explore');
    await expect(page.locator('.erow')).toHaveCount(ALLA);
  });
});
