// Färskhetsradens text måste kunna skilja tre lägen åt: vi nådde inte servern,
// Stockholm är tyst, eller här är datan.
//
// Buggen som de här testerna skyddar mot: exsumText tittade bara på d.total, så ett
// serverfel (0 rapporter inlästa) gav exakt samma mening som en lugn kväll —
// "Inga rapporter än — bli först att rapportera". Appen påstod att Stockholm var tomt
// när den i själva verket inte visste någonting.
//
// exsumText tar `state` som argument just därför att den då är ren och testbar utan DOM.
// Görs den om till att läsa en global variabel går den inte längre att testa här.

import { describe, it, expect } from 'vitest';
import { exsumText } from './harness.js';

const DATA = { fresh: 17, venueTotal: 28, lastTs: Date.now() - 3 * 60000, total: 42 };
const TOMT = { fresh: 0, venueTotal: 28, lastTs: null, total: 0 };

describe('exsumText — de tre lägena hålls åtskilda', () => {
  it('serverfel säger att kontakten saknas, inte att det är tomt', () => {
    const text = exsumText(TOMT, 'error');
    expect(text).toContain('Ingen kontakt');
    expect(text).not.toContain('Inga rapporter');
    expect(text).not.toContain('bli först');
  });

  it('tom databas säger att det är tomt och uppmanar till rapport', () => {
    expect(exsumText(TOMT, 'ok')).toBe('Inga rapporter än — bli först att rapportera');
  });

  it('serverfel och tom databas ger ALDRIG samma text', () => {
    // Det här var själva buggen.
    expect(exsumText(TOMT, 'error')).not.toBe(exsumText(TOMT, 'ok'));
  });

  it('med data visas färskheten', () => {
    expect(exsumText(DATA, 'ok')).toBe('17 av 28 ställen har färsk rapport · senast 3 min sedan');
  });
});

describe('exsumText — fel med data kvar i minnet', () => {
  it('varnar att siffrorna kan vara gamla i stället för att dölja dem', () => {
    const text = exsumText(DATA, 'error');
    expect(text).toContain('Ingen kontakt');
    expect(text).toContain('kan vara gamla');
  });

  it('skiljer fel-med-data från fel-utan-data', () => {
    expect(exsumText(DATA, 'error')).not.toBe(exsumText(TOMT, 'error'));
  });

  it('visar aldrig en färskhetssiffra när kontakten är bruten', () => {
    // "17 av 28 har färsk rapport" vore en lögn när vi inte nått servern.
    expect(exsumText(DATA, 'error')).not.toContain('av 28');
  });
});

describe('exsumText — laddning', () => {
  it('säger att hämtningen pågår, inte att det är tomt', () => {
    const text = exsumText(TOMT, 'loading');
    expect(text).toBe('Hämtar rapporter…');
    expect(text).not.toContain('Inga rapporter');
  });
});

describe('exsumText — alla fyra lägen är unika', () => {
  it('ger fyra olika meningar', () => {
    const texter = [
      exsumText(TOMT, 'loading'),
      exsumText(TOMT, 'error'),
      exsumText(DATA, 'error'),
      exsumText(TOMT, 'ok'),
      exsumText(DATA, 'ok')
    ];
    expect(new Set(texter).size).toBe(5);
  });
});
