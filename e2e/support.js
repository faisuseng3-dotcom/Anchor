// Delad rigg för E2E-testerna.
//
// VIKTIGT: varje test mockar Supabase. Inget test når produktionsdatabasen, och inget
// test skriver någonsin en rad. `mockSupabase` fångar alla REST-anrop; når ett anrop
// förbi mocken fallerar testet i stället för att tysta nå ut på nätet.

const DAY = 24 * 3600 * 1000;

/** En rapport i samma form som tabellen `reports` levererar. */
export function report(venueId, minsAgo, peopleAhead, opts = {}) {
  const now = Date.now();
  const at = (m) => new Date(now - m * 60000).toISOString();
  return {
    id: `${venueId}-${minsAgo}-${opts.type || 'initial'}`,
    venue_id: venueId,
    venue_name: opts.venueName || venueId,
    user_id: opts.userId || 'e2e-user',
    people_ahead: peopleAhead,
    report_type: opts.type || 'initial',
    queue_session: opts.session || null,
    queue_status: opts.status || (peopleAhead === 0 ? 'none' : peopleAhead > 25 ? 'long' : 'short'),
    comment: opts.comment || null,
    created_at: at(minsAgo),
    expires_at: at(minsAgo - 45)
  };
}

/**
 * Mockar Supabase REST och Mapbox.
 *
 * @param rows  rapporterna läsningen ska returnera, eller `'error'` för HTTP 500
 * @param opts.onInsert  anropas med det insatta objektet när appen skriver en rapport
 */
export async function mockSupabase(page, rows = [], opts = {}) {
  const inserts = [];
  await page.route('**/*.supabase.co/rest/**', (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());

    if (req.method() === 'POST') {
      // En skrivning. Spara den och svara som databasen gör — rör inget på riktigt.
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch { /* lämna null */ }
      if (url.includes('/rpc/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      inserts.push(body);
      if (opts.onInsert) opts.onInsert(body);
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }

    if (url.includes('on_my_way')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (rows === 'error') {
      return route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ message: 'e2e: framkallat serverfel' })
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      // Supabase exponerar Content-Range via CORS; utan det ser klienten count = null.
      headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`, 'access-control-expose-headers': 'content-range' },
      body: JSON.stringify(rows)
    });
  });

  // Mapbox kräver nätverk och en token; kartan har sitt eget felläge som testas separat.
  await page.route('**/*.mapbox.com/**', (route) => route.abort());

  return { inserts };
}

/** Hoppar över introduktion och samtycke, så testet landar direkt i appen. */
export async function skipOnboarding(page) {
  await page.addInitScript(() => {
    localStorage.setItem('qb_onboarding_done', 'true');
    localStorage.setItem('qb_consent', 'true');
    sessionStorage.setItem('qb_splash', '1'); // introt täcker appen i ~4 s; det testas inte här
    localStorage.removeItem('qb_testdata');
    localStorage.removeItem('qb_queue_session');
    localStorage.removeItem('qb_on_my_way');
  });
}

/** Går till appen och väntar tills den första inläsningen har renderat. */
export async function openApp(page, path = '/') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  // Appen startar sin inläsning direkt vid import; vänta på att något har renderats.
  await page.waitForFunction(
    () => typeof window.showScreen === 'function' && typeof window.loadReports === 'function',
    { timeout: 15000 }
  );
  await page.waitForTimeout(2500);
  return errors;
}

/** Byter skärm via appens egen funktion — det finns ingen router. */
export async function goToScreen(page, name) {
  await page.evaluate((n) => window.showScreen(n), name);
  await page.waitForTimeout(500);
}

export { DAY };
