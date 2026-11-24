// Spärrarna i supabase/migrations/20261122000000_report_hardening.sql. Alla migreringar körs i ordning i en riktig Postgres
// (PGlite, i minnet), med det Supabase har som de använder: rollerna, auth, pg_cron (bara cron.schedule) och realtid.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { VENUES, estimateWait } from './harness.js';

const dir = new URL('../supabase/migrations/', import.meta.url);
const venuesSql = readFileSync(new URL('../supabase/venues.sql', import.meta.url), 'utf8');
let db;

const headers = (h) => db.query("select set_config('request.headers', $1, false)", [h ? JSON.stringify(h) : '']);
let seq = 0;
// En kömätning från en ny telefon (nytt user_id, så spärren per id slår inte till).
const report = (venue, extra = {}) => db.query(
  `insert into reports (venue_id, venue_name, queue_status, user_id, people_ahead, report_type, queue_session, net, expires_at)
   values ($1, $2, 'short', $3, 5, $4, $5, $6, now()) returning venue_name, net, reporter`,
  [venue, extra.name || 'fritext', 'u-test-telefon-' + String(++seq).padStart(8, '0'), extra.type || 'initial',
   extra.session || null, extra.net || null]).then((r) => r.rows[0]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema cron;
    create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
    create publication supabase_realtime;
  `);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    // pg_cron finns inte i PGlite; cron.schedule ovan räcker för migreringarna.
    await db.exec(readFileSync(new URL(f, dir), 'utf8').replace('create extension if not exists pg_cron;', ''));
  }
  await db.exec(venuesSql);
}, 60000);

beforeEach(async () => {
  await db.exec('delete from reports; delete from report_ip_log; delete from on_my_way; delete from push_subscriptions;');
  await headers(null);
});

describe('venues', () => {
  it('venues.sql har samma ställen som VENUES, plus demon (kör node scripts/venue-names.mjs)', () => {
    const ids = [...venuesSql.matchAll(/^ {2}\('((?:[^']|'')*)'/gm)].map((m) => m[1].replace(/''/g, "'"));
    expect(ids.sort()).toEqual([...VENUES.map((v) => v.id), 'qbar-demo'].sort());
  });

  it('okänt ställe nekas, och namnet tas ur venues i stället för klientens fritext', async () => {
    await expect(report('finns-inte')).rejects.toThrow(/unknown_venue/);
    expect((await report('berns', { name: '<script>' })).venue_name).toBe(VENUES.find((v) => v.id === 'berns').name);
  });

  it('för långt queue_session nekas', async () => {
    await expect(report('berns', { session: 'qs-' + 'x'.repeat(40) })).rejects.toThrow(/reports_queue_session_len/);
  });
});

describe('IP-spärren', () => {
  it('utan headers (SQL-editorn, pg_cron) ingen spärr och inget nät', async () => {
    expect((await report('berns')).net).toBeNull();
  });

  it('ett API-anrop utan IP-adress nekas', async () => {
    await headers({ 'user-agent': 'x' });
    await expect(report('berns')).rejects.toThrow(/ip_required/);
  });

  it('x-forwarded-for: den sista posten räknas, den klienten själv kan skriva först gör det inte', async () => {
    await headers({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' });
    const a = await report('berns');
    await headers({ 'x-forwarded-for': '2.2.2.2,9.9.9.9' });
    const b = await report('berns');
    expect(a.net).toMatch(/^[0-9a-f]{10}$/);
    expect(b.net).toBe(a.net);
    await headers({ 'cf-connecting-ip': '3.3.3.3', 'x-forwarded-for': '9.9.9.9' });
    expect((await report('berns')).net).not.toBe(a.net); // cf-connecting-ip går först
  });

  it('högst 2 kömätningar per nät och ställe; klientens eget net skrivs över', async () => {
    await headers({ 'cf-connecting-ip': '4.4.4.4' });
    const a = await report('berns', { net: 'falskt' });
    expect(a.net).not.toBe('falskt');
    await report('berns');
    await expect(report('berns')).rejects.toThrow(/venue_ip_limited/);
    await report('kristall'); // ett annat ställe går bra
  });
});

describe('kö-sessioner', () => {
  it('en kömätning kan inte ta en annans queue_session', async () => {
    await report('berns', { session: 'qs-a' });
    await expect(report('berns', { session: 'qs-a' })).rejects.toThrow(/session_taken/);
  });
});

describe('överens per nät', () => {
  // Raderna läggs in förbi reports_guard, med valt nät och tid.
  async function load(rows) {
    await db.exec('alter table reports disable trigger user');
    for (const r of rows) {
      await db.query(`insert into reports (venue_id, venue_name, queue_status, user_id, people_ahead, report_type, near_venue,
        reporter, net, created_at, expires_at) values ('berns', 'Berns', 'long', 'x', $1, 'initial', true, $2, $3, $4, now() + interval '45 minutes')`,
        [r.people_ahead, r.reporter, r.net, r.created_at]);
    }
    await db.exec('alter table reports enable trigger user');
  }
  const rows = (nets) => nets.map((net, i) => ({ venue_id: 'berns', report_type: 'initial', people_ahead: 37, near_venue: true,
    reporter: 'p' + i, net, created_at: new Date(Date.now() - (5 + i) * 60000).toISOString() }));

  for (const [what, nets, want] of [
    ['tre id från samma nät är en person', ['n1', 'n1', 'n1'], false],
    ['tre nät är tre personer', ['n1', 'n2', 'n3'], true],
    ['gamla rader utan nät räknas per telefon', [null, null, null], true]
  ]) {
    it(what + ', i appen och i qbar_estimate', async () => {
      const rs = rows(nets);
      await load(rs);
      const sql = (await db.query("select confirmed from qbar_estimate('berns', now(), 2)")).rows[0];
      expect(sql.confirmed).toBe(want);
      expect(estimateWait('berns', rs, Date.now(), null).confirmed).toBe(want);
    });
  }

  it('anon läser net, som reporter', async () => {
    await load(rows(['n1']));
    await db.exec('set role anon');
    try { expect((await db.query('select net from reports')).rows).toEqual([{ net: 'n1' }]); }
    finally { await db.exec('reset role'); }
  });
});

describe('läsning och antal', () => {
  const insert = (ahead, status, user = 'u-test-telefon-' + String(++seq).padStart(8, '0')) => db.query(
    `insert into reports (venue_id, venue_name, queue_status, user_id, people_ahead, report_type, queue_session, expires_at)
     values ('berns', 'x', $1, $2, $3, 'initial', 'qs-' || $2, now()) returning id`, [status, user, ahead]);

  it('en kömätning utan antal nekas, och "Ingen kö" måste vara 0 framför', async () => {
    await expect(insert(null, 'long')).rejects.toThrow(/ahead_required/);
    await expect(insert(5, 'none')).rejects.toThrow(/status_mismatch/);
    await expect(insert(0, 'long')).rejects.toThrow(/status_mismatch/);
    await insert(0, 'none');
  });

  it('anon läser bara aktiva rader; historiken utan reporter, den egna bara med id:t', async () => {
    const me = 'u-test-telefon-gammal0001';
    await insert(17, 'short', me);
    await db.exec("update reports set expires_at = now() - interval '1 minute'"); // utgången, som en rapport från igår
    await db.exec('set role anon');
    try {
      expect((await db.query('select reporter from reports')).rows).toEqual([]);
      const hist = (await db.query('select * from report_history()')).rows;
      expect(hist).toHaveLength(1);
      expect(hist[0]).not.toHaveProperty('reporter');
      expect((await db.query('select venue_id from my_reports($1)', [me])).rows).toEqual([{ venue_id: 'berns' }]);
      expect((await db.query("select * from my_reports('kort')")).rows).toEqual([]);
    } finally { await db.exec('reset role'); }
  });
});

describe('på väg och notiser', () => {
  it('start_on_my_way tar bara kända ställen; stop_on_my_way rör inte demons korta id', async () => {
    await expect(db.query("select start_on_my_way('u-test-telefon-xxxxxxxx', 'finns-inte', 10)")).rejects.toThrow(/ogiltigt anrop/);
    await db.query("select start_on_my_way('u-test-telefon-xxxxxxxx', 'berns', 10)");
    await db.exec("insert into on_my_way values ('demo-krog-omw-1', 'qbar-demo', now() + interval '1 hour')");
    await db.query("select stop_on_my_way('demo-krog-omw-1')");
    await db.query("select stop_on_my_way('u-test-telefon-xxxxxxxx')");
    expect((await db.query('select user_id from on_my_way')).rows).toEqual([{ user_id: 'demo-krog-omw-1' }]);
  });

  it('save_push_subscription sparar högst 50 ställen', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => 'v' + i);
    await db.query("select save_push_subscription('https://web.push.apple.com/x', 'p', 'a', 'u', $1)", [ids]);
    expect((await db.query('select cardinality(venue_ids) n from push_subscriptions')).rows[0].n).toBe(50);
  });
});
