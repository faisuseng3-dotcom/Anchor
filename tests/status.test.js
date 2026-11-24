// computeStatus och forecastWait — gränserna som avgör vad kartan, listan och kortet visar.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeStatus, forecastWait, estimateWait, venueWaitText, setTestReports, report, agreed, NOW } from './harness.js';

afterEach(() => { vi.useRealTimers(); setTestReports([]); });

describe('computeStatus — bara färsk data', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });

  it('en rapport äldre än 45 min är ingen data', () => {
    // Förut föll den tillbaka på senaste rapporten oavsett ålder: kartan visade "30+ min" där listan sa "–".
    expect(computeStatus('kristall', [report('kristall', 60, null, { status: 'long' })])).toBe('unknown');
  });

  it('en rapport utan antal ger ingen status, hur färsk den än är (klienten väljer queue_status själv)', () => {
    expect(computeStatus('kristall', [report('kristall', 10, null, { status: 'long' })])).toBe('unknown');
  });

  it('1–10 personer är kort kö, inte "Ingen kö"', () => {
    expect(computeStatus('tjoget', agreed('tjoget', 2, 5))).toBe('short');
    expect(computeStatus('tjoget', agreed('tjoget', 2, 0))).toBe('none');
  });
});

describe('minst 3 personer för en väntetid', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  const p = (id, mins, ahead, user) => report(id, mins, ahead, { userId: user });

  it('1–2 personer: det de rapporterade, i färgen för få rapporter, aldrig minuter', () => {
    const tva = [p('kristall', 5, 17, 'a'), p('kristall', 3, 17, 'b')];
    setTestReports(tva);
    expect(computeStatus('kristall', tva)).toBe('few');
    expect(venueWaitText('kristall')).toBe('10–25 i kö');
    setTestReports([p('kristall', 5, 0, 'a')]);
    expect(venueWaitText('kristall')).toBe('Ingen kö');
  });

  it('samma person tre gånger räknas som en', () => {
    const en = [p('kristall', 15, 17, 'a'), p('kristall', 9, 17, 'a'), p('kristall', 3, 17, 'a')];
    expect(computeStatus('kristall', en)).toBe('few');
  });

  it('tre personer i olika intervall räcker inte', () => {
    const oense = [p('kristall', 5, 5, 'a'), p('kristall', 4, 17, 'b'), p('kristall', 3, 37, 'c')];
    expect(computeStatus('kristall', oense)).toBe('few');
  });

  it('tre personer i samma intervall: minuter', () => {
    setTestReports(agreed('kristall', 5, 17));
    expect(computeStatus('kristall', agreed('kristall', 5, 17))).not.toBe('few');
    expect(venueWaitText('kristall')).toMatch(/min$/);
  });

  it('två oense personer: "Går isär"', () => {
    setTestReports([p('kristall', 5, 0, 'a'), p('kristall', 3, 37, 'b')]);
    expect(venueWaitText('kristall')).toBe('Går isär');
  });
});

describe('computeStatus — stängda ställen', () => {
  it('ett ställe som stängt har ingen status, hur färsk rapporten än är', () => {
    // Lokal tid 01:30 — Akkurat stänger 01:00, Spy Bar 05:00.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 1, 30));
    const now = Date.now();
    const fresh = (id) => [1, 2, 3].map((i) => ({ ...report(id, 0, 0), reporter: 'p' + i, created_at: new Date(now - 5 * 60000).toISOString() }));
    expect(computeStatus('akkurat', fresh('akkurat'))).toBe('unknown');
    expect(computeStatus('spy-bar', fresh('spy-bar'))).toBe('none');
  });
});

describe('forecastWait — trenden', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  const three = (a, b, c) => [
    report('kristall', 25, a, { userId: 'u1' }),
    report('kristall', 15, b, { userId: 'u2' }),
    report('kristall', 1, c, { userId: 'u3' })
  ];

  it('en avvikare kan inte fördubbla kön: tillväxten är högst 0,5 personer/min', () => {
    // Tre överens (10–25) och en avvikare på 50+ sist: prognosen visas, men avvikaren får inte dra iväg den.
    const reps = [...three(17, 17, 60), report('kristall', 10, 17, { userId: 'u4' })];
    setTestReports(reps);
    const now = estimateWait('kristall', reps);
    const fc = forecastWait('kristall', 15, 0);
    expect(fc.ahead).toBeLessThanOrEqual(Math.round(now.ahead + 0.5 * 15));
  });

  it('en oförändrad kö får samma osäkerhet som siffran ovanför', () => {
    const reps = three(17, 17, 17);
    setTestReports(reps);
    const now = estimateWait('kristall', reps);
    const fc = forecastWait('kristall', 15, 0);
    expect([fc.low, fc.high]).toEqual([now.low, now.high]);
  });

  it('en enda persons rapporter är ingen trend', () => {
    const reps = [report('kristall', 25, 5), report('kristall', 15, 17), report('kristall', 1, 60)];
    setTestReports(reps);
    expect(forecastWait('kristall', 15, 0)).toBeNull();
  });
});
