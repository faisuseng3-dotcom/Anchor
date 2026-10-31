// computeStatus och forecastWait — gränserna som avgör vad kartan, listan och kortet visar.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeStatus, forecastWait, estimateWait, setTestReports, report, NOW } from './harness.js';

afterEach(() => { vi.useRealTimers(); setTestReports([]); });

describe('computeStatus — bara färsk data', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });

  it('en rapport äldre än 45 min är ingen data', () => {
    // Förut föll den tillbaka på senaste rapporten oavsett ålder: kartan visade "30+ min" där listan sa "–".
    expect(computeStatus('kristall', [report('kristall', 60, null, { status: 'long' })])).toBe('unknown');
  });

  it('en färsk rapport utan antal räknas fortfarande', () => {
    expect(computeStatus('kristall', [report('kristall', 10, null, { status: 'long' })])).toBe('long');
  });

  it('1–10 personer är kort kö, inte "Ingen kö"', () => {
    expect(computeStatus('tjoget', [report('tjoget', 2, 5)])).toBe('short');
    expect(computeStatus('tjoget', [report('tjoget', 2, 0)])).toBe('none');
  });
});

describe('computeStatus — stängda ställen', () => {
  it('ett ställe som stängt har ingen status, hur färsk rapporten än är', () => {
    // Lokal tid 01:30 — Akkurat stänger 01:00, Spy Bar 05:00.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 1, 30));
    const now = Date.now();
    const fresh = (id) => ({ ...report(id, 0, 0), created_at: new Date(now - 5 * 60000).toISOString() });
    expect(computeStatus('akkurat', [fresh('akkurat')])).toBe('unknown');
    expect(computeStatus('spy-bar', [fresh('spy-bar')])).toBe('none');
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
    const reps = three(5, 17, 60);
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
