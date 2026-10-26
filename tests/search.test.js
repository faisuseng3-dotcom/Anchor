// venueScore och venueSearch — den gemensamma fuzzy-sökningen.
// Tio poängnivåer med längdgrindar. Nivåerna är dokumenterade i koden ovanför venueScore.

import { describe, it, expect } from 'vitest';
import { venueScore, venueSearch, getVenueById, VENUES, _searchNorm } from './harness.js';

const spy = getVenueById('spy-bar');
const sturehof = getVenueById('sturehof');
const names = (q) => venueSearch(q, VENUES).map((v) => v.id);

describe('_searchNorm — normalisering', () => {
  it('gör om till gemena', () => {
    expect(_searchNorm('SPY BAR')).toBe(_searchNorm('spy bar'));
  });

  it('behandlar svenska tecken konsekvent', () => {
    expect(_searchNorm('Trädgården')).toBe(_searchNorm('TRÄDGÅRDEN'));
  });
});

describe('venueScore — poängnivåerna', () => {
  it('exakt namnträff ger 100', () => {
    expect(venueScore('spy bar', spy)).toBe(100);
  });

  it('namn som börjar med sökordet ger 90', () => {
    expect(venueScore('spy', spy)).toBe(90);
  });

  it('kompakt träff utan mellanslag ger 85', () => {
    expect(venueScore('spybar', spy)).toBe(85);
  });

  it('ord inne i namnet som börjar med sökordet ger 70', () => {
    expect(venueScore('bar', spy)).toBe(70);
  });

  it('områdesträff ger lägre poäng än namnträff', () => {
    expect(venueScore('östermalm', spy)).toBeLessThan(venueScore('spy', spy));
    expect(venueScore('östermalm', spy)).toBeGreaterThan(0);
  });

  it('adressträff ger ännu lägre poäng', () => {
    const adress = venueScore('birger', spy);
    expect(adress).toBeGreaterThan(0);
    expect(adress).toBeLessThan(venueScore('östermalm', spy));
  });

  it('utan träff ger -1', () => {
    expect(venueScore('zzzzz', spy)).toBe(-1);
  });
});

describe('venueScore — längdgrindarna', () => {
  it('ett enda tecken matchar inte adress eller område', () => {
    // Grindarna finns för att ett tecken annars skulle träffa nästan allt
    expect(venueScore('b', sturehof)).toBe(-1);
  });

  it('ett tecken matchar fortfarande ett namn som börjar så', () => {
    expect(venueScore('s', sturehof)).toBeGreaterThan(0);
  });

  it('två tecken räcker för kompakt träff', () => {
    expect(venueScore('st', sturehof)).toBeGreaterThan(0);
  });
});

describe('venueSearch — sortering och filtrering', () => {
  it('tom sökning ger alla ställen', () => {
    expect(venueSearch('', VENUES)).toHaveLength(28);
  });

  it('bästa träffen kommer först', () => {
    expect(names('spy')[0]).toBe('spy-bar');
    expect(names('berns')[0]).toBe('berns');
    expect(names('trädgården')[0]).toBe('tradgarden');
  });

  it('utesluter ställen utan träff', () => {
    const resultat = names('spy');
    expect(resultat).toContain('spy-bar');
    expect(resultat).not.toContain('berns');
  });

  it('ger tomt resultat för nonsens', () => {
    expect(names('qqqqzzz')).toHaveLength(0);
  });

  it('en områdessökning ger alla ställen i området', () => {
    const resultat = names('hornstull');
    expect(resultat).toContain('tjoget');
    expect(resultat.length).toBeGreaterThan(1);
  });

  it('är inte skiftlägeskänslig', () => {
    expect(names('SPY')).toEqual(names('spy'));
  });

  it('muterar inte indata', () => {
    const kopia = VENUES.slice();
    venueSearch('spy', VENUES);
    expect(VENUES).toEqual(kopia);
  });

  it('sökningen hittar stavning utan svenska tecken', () => {
    // Någon som skriver "tradgarden" i en kö ska hitta Trädgården
    expect(names('tradgarden')).toContain('tradgarden');
  });
});
