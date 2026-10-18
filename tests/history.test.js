// historicalRateFor och nightKey — dörrtakt från tidigare kvällar.
// Reglerna: samma ställe, samma veckodag, ±1 timme, minst 3 sessioner,
// och kvällen kring den aktuella tidpunkten räknas inte som sin egen historik.

import { describe, it, expect } from 'vitest';
import { historicalRateFor, nightKey, NOW } from './harness.js';

const WEEK = 7 * 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

/** En post i den form sessionRates returnerar. */
const rate = (venueId, startedAt, r = 1.0) => ({ venueId, startedAt, rate: r });

/** N sessioner samma veckodag och timme, N veckor bakåt. */
function weeksBack(venueId, n, r = 1.0, offsetMs = 0) {
  return Array.from({ length: n }, (_, i) => rate(venueId, NOW - (i + 1) * WEEK + offsetMs, r));
}

describe('nightKey — kvällen räknas från 06:00', () => {
  it('fredag 23:00 hör till fredag', () => {
    const fri2300 = new Date('2026-10-16T21:00:00.000Z').getTime(); // fredag
    expect(nightKey(fri2300).dow).toBe(5);
  });

  it('lördag 00:30 hör också till fredagskvällen', () => {
    const sat0030 = new Date('2026-10-16T22:30:00.000Z').getTime();
    expect(nightKey(sat0030).dow).toBe(5);
  });

  it('lördag 07:00 hör till lördagen', () => {
    const sat0700 = new Date('2026-10-17T05:00:00.000Z').getTime();
    expect(nightKey(sat0700).dow).toBe(6);
  });

  it('timmen läses av lokal tid, inte den förskjutna', () => {
    const t = new Date('2026-10-16T21:00:00.000Z').getTime();
    expect(nightKey(t).hour).toBe(new Date(t).getHours());
  });
});

describe('historicalRateFor — tröskeln på tre sessioner', () => {
  it('ger null med två matchande sessioner', () => {
    expect(historicalRateFor('spy-bar', weeksBack('spy-bar', 2), NOW)).toBeNull();
  });

  it('ger ett värde med tre matchande sessioner', () => {
    const h = historicalRateFor('spy-bar', weeksBack('spy-bar', 3, 1.5), NOW);
    expect(h).not.toBeNull();
    expect(h.n).toBe(3);
    expect(h.rate).toBe(1.5);
  });

  it('ger null när historiken är tom', () => {
    expect(historicalRateFor('spy-bar', [], NOW)).toBeNull();
  });

  it('använder medianen, inte medelvärdet', () => {
    const rates = [
      rate('spy-bar', NOW - WEEK, 1.0),
      rate('spy-bar', NOW - 2 * WEEK, 2.0),
      rate('spy-bar', NOW - 3 * WEEK, 9.0)
    ];
    expect(historicalRateFor('spy-bar', rates, NOW).rate).toBe(2.0);
  });
});

describe('historicalRateFor — vilka sessioner som matchar', () => {
  it('tar bara det efterfrågade stället', () => {
    const rates = [...weeksBack('spy-bar', 3, 1.0), ...weeksBack('berns', 3, 5.0)];
    expect(historicalRateFor('spy-bar', rates, NOW).rate).toBe(1.0);
    expect(historicalRateFor('berns', rates, NOW).rate).toBe(5.0);
  });

  it('godtar en timme tidigare och en timme senare', () => {
    const rates = [
      rate('spy-bar', NOW - WEEK - HOUR, 1.0),
      rate('spy-bar', NOW - 2 * WEEK + HOUR, 1.0),
      rate('spy-bar', NOW - 3 * WEEK, 1.0)
    ];
    expect(historicalRateFor('spy-bar', rates, NOW).n).toBe(3);
  });

  it('utesluter sessioner mer än en timme från tidpunkten', () => {
    expect(historicalRateFor('spy-bar', weeksBack('spy-bar', 3, 1.0, 3 * HOUR), NOW)).toBeNull();
  });

  it('utesluter en annan veckodag', () => {
    // En dag bakåt är en annan veckodag, oavsett timme
    const rates = Array.from({ length: 4 }, (_, i) =>
      rate('spy-bar', NOW - WEEK * (i + 1) - 24 * HOUR, 1.0));
    expect(historicalRateFor('spy-bar', rates, NOW)).toBeNull();
  });

  it('utesluter ikväll — 12-timmarsregeln', () => {
    // Fyra sessioner från samma kväll ska inte bli sin egen historik
    const ikvall = Array.from({ length: 4 }, (_, i) => rate('spy-bar', NOW - i * HOUR, 1.0));
    expect(historicalRateFor('spy-bar', ikvall, NOW)).toBeNull();
  });

  it('godtar en session strax över 12 timmar bort', () => {
    const rates = Array.from({ length: 3 }, (_, i) =>
      rate('spy-bar', NOW - (i + 1) * WEEK, 1.0));
    expect(historicalRateFor('spy-bar', rates, NOW).n).toBe(3);
  });
});
