// venueScore och venueSearch — den gemensamma fuzzy-sökningen.
// Tio poängnivåer med längdgrindar. Nivåerna är dokumenterade i koden ovanför venueScore.

import { describe, it, expect } from 'vitest';
import { venueScore, venueSearch, getVenueById, VENUES, _searchNorm, areaHits, didYouMean } from './harness.js';

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
    expect(venueSearch('', VENUES)).toHaveLength(VENUES.length);
  });

  it('bästa träffen kommer först', () => {
    expect(names('spy')[0]).toBe('spy-bar');
    expect(names('berns')[0]).toBe('berns');
    expect(names('södra bar')[0]).toBe('sodra-bar');
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
    // Någon som skriver "sodra bar" i en kö ska hitta Södra Bar
    expect(names('sodra bar')).toContain('sodra-bar');
  });
});

describe('areaHits — kartans sök flyger till ett område', () => {
  const areas = (q) => areaHits(q, VENUES).map((h) => h.area);

  it('början av namnet räcker, utan svenska tecken och skiftläge', () => {
    expect(areas('söder')).toEqual(['Södermalm']);
    expect(areas('SODER')).toEqual(['Södermalm']);
    expect(areas('gamla stan')).toEqual(['Gamla Stan']);
  });

  it('färre än tre tecken flyttar inte kartan', () => {
    expect(areas('sö')).toEqual([]);
  });

  it('matchar bara från början — "malm" är inte Södermalm', () => {
    expect(areas('malm')).toEqual([]);
  });

  it('räknar ställena i området', () => {
    const [hit] = areaHits('kungsholmen', VENUES);
    expect(hit.count).toBe(VENUES.filter((v) => v.area === 'Kungsholmen').length);
  });
});

describe('venueSearch — svarar inte säkert på nonsens', () => {
  it('tre lösa bokstäver hittar ingenting', () => {
    // Förut gav "lol" sex ställen och "aaa" 43, eftersom bokstäverna fick ligga var som helst i namnet.
    expect(names('lol')).toEqual([]);
    expect(names('aaa')).toEqual([]);
    expect(names('asdf')).toEqual([]);
  });

  it('en felstavning nära namnet hittar fortfarande rätt', () => {
    expect(names('kristll')).toEqual(['kristall']);
  });

  it('å, ä och ö i sökningen gäller: "öl" hittar inte "Old Beefeater"', () => {
    const r = venueSearch('öl', VENUES).map((v) => v.name);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((n) => /^öl|\söl/i.test(n))).toBe(true);
  });

  it('utan svenska tecken vikas de bort: "sodra bar" hittar Södra Bar', () => {
    expect(names('sodra bar')[0]).toBe('sodra-bar');
  });

  it('med å/ä/ö i sökningen vikas andra accenter ändå: "ölkafe" hittar Katarina Ölkafé', () => {
    expect(names('ölkafe')).toContain('katarina-olkafe');
    expect(names('ölkafé')).toEqual(names('ölkafe'));
  });

  it('Stureplan är en plats: sökningen hittar klubbarna runt torget, och kartans sök erbjuder platsen', () => {
    const r = names('stureplan');
    for (const id of ['sturehof', 'drama', 'sturecompagniet', 'hells-kitchen', 'spy-bar']) expect(r).toContain(id);
    expect(r).not.toContain('berns');
    expect(areaHits('sture', VENUES).map((h) => h.area)).toContain('Stureplan');
  });
});

describe('venueSearch — vanliga sökningar som förut gav noll', () => {
  it('namn plus typ eller område', () => {
    expect(names('berns bar')).toEqual(['berns']);
    expect(names('tjoget hornstull')).toEqual(['tjoget']);
  });

  it('typordet hittar alla av den typen och inga andra', () => {
    const r = venueSearch('nattklubb', VENUES);
    expect(r.length).toBe(VENUES.filter((v) => v.type === 'klubb').length);
    expect(r.every((v) => v.type === 'klubb')).toBe(true);
  });

  it('apostrofen spelar ingen roll: rak och typografisk hittar samma ställen', () => {
    const john = ['john-scott-s-kungsgatan', 'john-scott-s-kungstradgarden'];
    expect(names("john scott's").sort()).toEqual(john);
    expect(names('john scott’s').sort()).toEqual(john);
    expect(names('kelly’s')).toEqual(names("kelly's"));
    expect(names("kelly's")[0]).toBe('kelly-s');
  });
});

describe('didYouMean — frågar i stället för att gissa tyst', () => {
  it('föreslår området vid en felstavning', () => {
    expect(didYouMean('gamal stan', VENUES)).toEqual({ text: 'Gamla Stan', area: true, id: undefined });
  });

  it('föreslår ett ställe vid en felstavning', () => {
    expect(didYouMean('berms', VENUES)).toMatchObject({ text: 'Berns', area: false, id: 'berns' });
  });

  it('föreslår inget för nonsens eller korta ord', () => {
    expect(didYouMean('qqqqzzz', VENUES)).toBeNull();
    expect(didYouMean('abc', VENUES)).toBeNull();
  });
});
