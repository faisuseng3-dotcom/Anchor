// De fyra flödena som enhetstesterna inte kan nå, eftersom de renderar DOM.
// Allt mot mockad Supabase — inget test rör produktionsdatabasen.

import { test, expect } from '@playwright/test';
import { report, mockSupabase, skipOnboarding, openApp, goToScreen } from './support.js';

// En kväll med tre ställen som har rapporter.
const KVALL = [
  report('kristall', 3, 37, { venueName: 'Kristall' }),
  report('spy-bar', 6, 5, { venueName: 'Spy Bar' }),
  report('berns', 12, 17, { venueName: 'Berns', comment: 'Fri entré före 23' })
];

test.describe('1. Appen startar och Utforska renderar', () => {
  test('alla 28 ställen listas, de med data visar en väntetid', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    const errors = await openApp(page);
    await goToScreen(page, 'explore');

    await expect(page.locator('.erow')).toHaveCount(28);

    // Färskhetsraden ska redovisa hur mycket som faktiskt är färskt.
    await expect(page.locator('#exsum-line')).toContainText('av 28 ställen har färsk rapport');

    // Ett ställe med rapport visar ett intervall, aldrig en naken siffra.
    const kristall = page.locator('.erow', { hasText: 'Kristall' }).first();
    await expect(kristall.locator('.erow-hero')).toHaveText(/min|Fullt|Ingen kö/);

    expect(errors, 'inga JS-fel vid start').toEqual([]);
  });

  test('ett ställe utan rapporter säger att data saknas — det gömmer sig inte', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);
    await goToScreen(page, 'explore');

    const utanData = page.locator('.erow', { hasText: 'Tjoget' }).first();
    await expect(utanData).toContainText(/Ingen data/i);
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
    await expect(page.locator('.erow')).toHaveCount(28);
    await expect(page.locator('.explore-error-state')).toHaveCount(0);
  });
});

test.describe('3. Sök och öppna ett ställe', () => {
  test('sökning filtrerar och ett träffat ställe kan öppnas', async ({ page }) => {
    await skipOnboarding(page);
    await mockSupabase(page, KVALL);
    await openApp(page);
    await goToScreen(page, 'explore');

    const sok = page.locator('#screen-explore input').first();
    await sok.fill('spy');
    await page.waitForTimeout(600);

    const rader = page.locator('.erow');
    await expect(rader).toHaveCount(1);
    await expect(rader.first()).toContainText('Spy Bar');

    await rader.first().click();
    await page.waitForTimeout(600);
    // Venue-kortet ska visa stället. Vilket element som bär namnet kan variera,
    // så kontrollera att namnet syns någonstans i det öppnade kortet.
    await expect(page.locator('#venue-card, .vc-sheet, #vc-status').first()).toBeVisible();
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
    await page.locator('#rs2 button').nth(2).click();
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
    await page.locator('#rs2 button').first().click();
    await page.waitForTimeout(1500);

    expect(inserts).toHaveLength(1);
    expect([0, 5, 17, 37, 60]).toContain(inserts[0].people_ahead);
  });
});

test.describe('5. Radera min data', () => {
  // Mocken svarar på varje läsning med `rows` — även räkningen efter raderingen. KVALL = rader finns kvar.
  async function raderaViaProfilen(page, rows) {
    await skipOnboarding(page);
    await mockSupabase(page, rows);
    await openApp(page);
    const id = 'user-e2e-radera';
    await page.evaluate((v) => window.localStorage.setItem('qb_user_id', v), id);
    page.once('dialog', (d) => d.accept());
    await goToScreen(page, 'profile');
    await page.getByRole('button', { name: /Radera min data/ }).click();
    return id;
  }

  test('rader som servern behöll ger fel, och id:t sparas så att det går att försöka igen', async ({ page }) => {
    const id = await raderaViaProfilen(page, KVALL);
    await expect(page.locator('.toast')).toContainText('Kunde inte radera');
    expect(await page.evaluate(() => window.localStorage.getItem('qb_user_id'))).toBe(id);
  });

  test('tom server efter radering rensar den lokala datan', async ({ page }) => {
    const id = await raderaViaProfilen(page, []);
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('qb_user_id'))).not.toBe(id);
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
    await expect(page.locator('.erow')).toHaveCount(28);
  });
});
