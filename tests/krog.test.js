// Qbar för krogar: statistiken räknas i Supabase (supabase/migrations/20261118000000_krog.sql), men ska räknas som
// appen. Här körs migreringen i en riktig Postgres (PGlite, i minnet) och SQL-modellen jämförs med estimateWait,
// sessionRates och historicalRateFor ur src/main.js på slumpade men fasta kvällar. Larmar testet har modellen ändrats
// på ett ställe men inte det andra. Sist: vem som får läsa och skriva vad.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  estimateWait, formatWait, reportedText, waitToStatus, sessionRates, historicalRateFor, NOW
} from './harness.js';

const MIGRATIONS = ['20261118000000_krog.sql', '20261118010000_krog_no_direct_reports.sql']
  .map((f) => readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
const MIN = 60000;
let db;

// Fast slump: samma kvällar varje körning.
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// En kväll vid `at`: lösa kömätningar från fem personer och några kö-sessioner med uppföljningar.
function evening(rand, at) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const rows = [];
  const row = (minsAgo, ahead, extra = {}) => rows.push({
    venue_id: 'berns', report_type: 'initial', people_ahead: ahead, queue_session: null,
    near_venue: pick([null, true, true, false]), reporter: pick(['p1', 'p2', 'p3', 'p4', 'p5']),
    created_at: new Date(at - Math.round(minsAgo * 60) * 1000).toISOString(), ...extra
  });
  for (let i = 0, n = Math.floor(rand() * 8); i < n; i++) row(rand() * 55, pick([0, 5, 17, 37, 60]));
  for (let s = 0, n = Math.floor(rand() * 4); s < n; s++) {
    let t = 10 + rand() * 40, ahead = pick([5, 17, 37, 60]);
    const id = 'qs-' + rand();
    row(t, ahead, { queue_session: id });
    for (let k = 0, m = 1 + Math.floor(rand() * 3); k < m && t > 4; k++) {
      t -= 3 + rand() * 12;
      ahead = pick([ahead, ahead, 0, 5, 17].filter((a) => a <= ahead));
      row(Math.max(0, t), ahead, { queue_session: id, report_type: ahead === 0 && rand() < 0.5 ? 'entered' : 'followup' });
    }
  }
  return rows;
}

async function load(rows) {
  await db.exec('delete from reports');
  for (const r of rows) {
    await db.query(
      'insert into reports (venue_id, report_type, people_ahead, queue_session, near_venue, reporter, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [r.venue_id, r.report_type, r.people_ahead, r.queue_session, r.near_venue, r.reporter, r.created_at]);
  }
}

beforeAll(async () => {
  db = new PGlite();
  // Det Supabase har som migreringen använder: rollerna, auth.users/auth.uid() och kolumnerna i reports och on_my_way.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table public.reports (id uuid primary key default gen_random_uuid(), venue_id text not null,
      report_type text not null default 'initial', people_ahead smallint, queue_session text, near_venue boolean,
      reporter text, user_id text, created_at timestamptz not null);
    create table public.on_my_way (user_id text primary key, venue_id text not null, expires_at timestamptz not null);
    -- Som i produktionen (20261111030000_hide_user_id): alla kolumner utom user_id.
    grant select (id, venue_id, report_type, people_ahead, queue_session, near_venue, reporter, created_at)
      on public.reports to anon, authenticated;
    grant insert on public.reports to anon, authenticated;
  `);
  for (const sql of MIGRATIONS) await db.exec(sql);
}, 60000);

describe('SQL-modellen räknar som appen', () => {
  it('qbar_estimate ger samma kö, minuter, text och status som estimateWait', async () => {
    const rand = rng(7);
    let compared = 0;
    for (let i = 0; i < 150; i++) {
      const rows = evening(rand, NOW);
      const prior = [0.7, 1, 2, 3][i % 4];
      await load(rows);
      const sql = (await db.query('select * from qbar_estimate($1, $2, $3)', ['berns', new Date(NOW).toISOString(), prior])).rows[0];
      const est = estimateWait('berns', rows, NOW, { rate: prior });
      if (!est) { expect(sql.ahead, JSON.stringify(rows)).toBeNull(); continue; }
      compared++;
      const got = { ahead: sql.ahead, mins: +sql.mins.toFixed(9), low: sql.low, high: sql.high, confirmed: sql.confirmed,
        full: sql.is_full, text: sql.wait_text, status: sql.status };
      expect(got, JSON.stringify(rows)).toEqual({ ahead: est.ahead, mins: +est.mins.toFixed(9), low: est.low,
        high: est.high, confirmed: est.confirmed, full: est.full,
        text: est.confirmed ? formatWait(est) : reportedText(est), status: est.confirmed ? waitToStatus(est) : 'few' });
    }
    expect(compared).toBeGreaterThan(100); // slumpen ska ge riktiga köer, inte mest tomma kvällar
  });

  it('qbar_rates och qbar_prior ger samma takter som sessionRates och historicalRateFor', async () => {
    const rand = rng(11);
    // Åtta veckor av kvällar runt 22–01, så att samma veckodag ±1 timme har flera sessioner.
    const rows = [];
    for (let d = 0; d < 56; d++) {
      for (let k = 0; k < 3; k++) {
        const at = NOW - d * 24 * 60 * MIN + Math.round((rand() * 4 - 2) * 60) * MIN;
        rows.push(...evening(rand, at).filter((r) => r.queue_session));
      }
    }
    await load(rows);
    // Fönstret täcker alla rader (några kvällar slutar efter NOW), som när appen läser 8 veckor bakåt.
    const since = new Date(NOW - 9 * 7 * 24 * 60 * MIN).toISOString(), until = new Date(NOW + 24 * 60 * MIN).toISOString();
    const sql = (await db.query('select rate, started_at from qbar_rates($1, $2, $3)', ['berns', since, until])).rows;
    const js = sessionRates(rows);
    const key = (rate, t) => new Date(t).getTime() + ':' + rate.toFixed(9);
    expect(sql.map((r) => key(r.rate, r.started_at)).sort()).toEqual(js.map((r) => key(r.rate, r.startedAt)).sort());

    const rates = sql.map((r) => r.rate), starts = sql.map((r) => r.started_at.toISOString());
    let found = 0;
    for (let h = -30; h <= 30; h++) {
      const at = NOW + h * 60 * MIN;
      const p = (await db.query('select qbar_prior($1::float8[], $2::timestamptz[], $3, -1) p', [rates, starts, new Date(at).toISOString()])).rows[0].p;
      const want = historicalRateFor('berns', js, at);
      expect(p === -1 ? null : +p.toFixed(9), 'at ' + new Date(at).toISOString()).toBe(want && +want.rate.toFixed(9));
      if (want) found++;
    }
    expect(found).toBeGreaterThan(5);
  });
});

describe('Vem når vad', () => {
  const BERNS = '00000000-0000-0000-0000-00000000000b', STRANGER = '00000000-0000-0000-0000-00000000000c';
  const as = async (role, uid, sql) => {
    await db.exec(`set role ${role}; select set_config('test.uid', '${uid || ''}', false);`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  };

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users values ('${BERNS}', 'Kvall@berns.se', now()), ('${STRANGER}', 'falsk@berns.se', null);
      insert into venue_accounts values ('kvall@berns.se', 'berns', 'slow'), ('falsk@berns.se', 'berns', 'slow');
    `);
  });
  it('bara ett inloggat ställe med avtal och bekräftad e-post får statistik', async () => {
    await expect(as('anon', null, 'select venue_stats()')).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', STRANGER, 'select venue_stats()')).rejects.toThrow(/inget avtal/);
    const stats = (await as('authenticated', BERNS, 'select venue_stats() s')).rows[0].s;
    expect(stats.venue_id).toBe('berns');
  });

  it('kön just nu i statistiken är appens text för samma rapporter', async () => {
    const now = Date.now();
    const rows = ['p1', 'p2', 'p3'].map((p, i) => ({ venue_id: 'berns', report_type: 'initial', people_ahead: 37,
      queue_session: null, near_venue: true, reporter: p, created_at: new Date(now - (5 + i) * MIN).toISOString() }));
    await load(rows);
    const stats = (await as('authenticated', BERNS, 'select venue_stats() s')).rows[0].s;
    const est = estimateWait('berns', rows, now, null); // berns har pace slow, som kontot
    expect(stats.now).toEqual({ text: formatWait(est), status: waitToStatus(est), fresh: 3 });
  });

  it('raden läses av alla men skrivs bara av stället, och bara via save_venue_note', async () => {
    await as('authenticated', BERNS, "select save_venue_note(' Från 22:00 ', '', 'DJ i Salongen')");
    const row = (await as('anon', null, 'select venue_id, entry, guestlist, tonight from venue_notes')).rows;
    expect(row).toEqual([{ venue_id: 'berns', entry: 'Från 22:00', guestlist: null, tonight: 'DJ i Salongen' }]);
    await expect(as('authenticated', STRANGER, "select save_venue_note('x', 'x', 'x')")).rejects.toThrow(/inget avtal/);
    await expect(as('anon', null, "select save_venue_note('x', 'x', 'x')")).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', BERNS, "update venue_notes set entry = 'x'")).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, 'select * from venue_accounts')).rejects.toThrow(/permission denied/);
    // Inloggat ställe: inga rapporter direkt, bara venue_stats(). Anon (appen) läser som förut.
    await expect(as('authenticated', BERNS, 'select venue_id from reports')).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', BERNS, "insert into reports (venue_id, created_at) values ('berns', now())")).rejects.toThrow(/permission denied/);
    expect((await as('anon', null, 'select venue_id from reports')).rows.length).toBeGreaterThan(0);
    await expect(as('anon', null, "select * from qbar_estimate('berns', now(), 2)")).rejects.toThrow(/permission denied/);
  });
});
