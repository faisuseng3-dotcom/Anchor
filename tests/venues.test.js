// VENUES-arrayens integritet. Ställena ligger i kod, inte i databasen, och det finns
// ingen validering någonstans — ett fält som glöms eller en koordinat som är fel upptäcks
// i dag först av en användare som står på fel gata.

import { describe, it, expect } from 'vitest';
import { VENUES, PACE_RATE, getVenueById } from './harness.js';

const FIELDS = ['id', 'name', 'address', 'area', 'type', 'lat', 'lng', 'closing', 'pace'];

/** Avstånd i meter mellan två punkter. */
function metersBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

describe('VENUES — struktur', () => {
  it('innehåller 28 ställen', () => {
    expect(VENUES).toHaveLength(28);
  });

  it('varje id är unikt', () => {
    const ids = VENUES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('varje ställe har alla nio fält', () => {
    for (const v of VENUES) {
      for (const f of FIELDS) {
        expect(v[f], `${v.id} saknar ${f}`).toBeDefined();
      }
    }
  });

  it('id är gemena med bindestreck — de hamnar i onclick-attribut', () => {
    for (const v of VENUES) {
      expect(v.id, `${v.id} har tecken som inte hör i ett HTML-attribut`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('getVenueById hittar varje ställe', () => {
    for (const v of VENUES) expect(getVenueById(v.id)).toBe(v);
  });

  it('getVenueById ger undefined för okänt id', () => {
    expect(getVenueById('finns-inte')).toBeUndefined();
  });
});

describe('VENUES — fältvärden', () => {
  it('type är bar eller klubb', () => {
    for (const v of VENUES) expect(['bar', 'klubb']).toContain(v.type);
  });

  it('pace finns i PACE_RATE', () => {
    for (const v of VENUES) {
      expect(Object.keys(PACE_RATE), `${v.id} har pace "${v.pace}"`).toContain(v.pace);
    }
  });

  it('closing är HH:MM', () => {
    for (const v of VENUES) expect(v.closing, v.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });

  it('koordinaterna ligger i Stockholms innerstad', () => {
    for (const v of VENUES) {
      expect(v.lat, `${v.id} lat utanför Stockholm`).toBeGreaterThan(59.28);
      expect(v.lat, `${v.id} lat utanför Stockholm`).toBeLessThan(59.38);
      expect(v.lng, `${v.id} lng utanför Stockholm`).toBeGreaterThan(17.95);
      expect(v.lng, `${v.id} lng utanför Stockholm`).toBeLessThan(18.15);
    }
  });

  it('namn och adress är icke-tomma', () => {
    for (const v of VENUES) {
      expect(v.name.trim().length, v.id).toBeGreaterThan(0);
      expect(v.address.trim().length, v.id).toBeGreaterThan(0);
    }
  });
});

describe('VENUES — kartnålar som går att träffa', () => {
  // Kartan ritar nålar med icon-allow-overlap: true. Två ställen på nästan samma punkt
  // hamnar ovanpå varandra och ett av dem går inte att träffa med fingret.
  const pairsCloserThan = (m) => {
    const out = [];
    for (let i = 0; i < VENUES.length; i++) {
      for (let j = i + 1; j < VENUES.length; j++) {
        const d = metersBetween(VENUES[i], VENUES[j]);
        if (d < m) out.push(`${VENUES[i].id} ↔ ${VENUES[j].id} (${Math.round(d)} m)`);
      }
    }
    return out;
  };

  // ── KÄNT PROBLEM — dokumenterat, inte åtgärdat ────────────────────────────
  // sturecompagniet och hells-kitchen delar adressen "Sturegatan 4" och ligger 3 m isär.
  // Åtgärd: rätta koordinaterna, eller sätt icon-allow-overlap: false, eller förskjut
  // nålar under 25 m. När det är gjort ska det här testet vändas till toEqual([]).
  it('KÄNT PROBLEM: två ställen ligger under 10 m från varandra', () => {
    expect(pairsCloserThan(10)).toEqual(['sturecompagniet ↔ hells-kitchen (3 m)']);
  });

  it('KÄNT PROBLEM: tio par ligger under 60 m från varandra', () => {
    expect(pairsCloserThan(60)).toHaveLength(10);
  });

  it('inga två ställen delar exakt samma koordinat', () => {
    const points = VENUES.map((v) => `${v.lat},${v.lng}`);
    expect(new Set(points).size).toBe(points.length);
  });
});

describe('VENUES — dubbletter som pekar på datafel', () => {
  // ── KÄNT PROBLEM ──────────────────────────────────────────────────────────
  // Hell's Kitchen ligger i samma byggnad som Sturecompagniet, så adressen kan vara
  // riktig — men kombinationen med 3 m avstånd gör att en av nålarna är onåbar.
  it('KÄNT PROBLEM: en adress delas av två ställen', () => {
    const byAddress = {};
    for (const v of VENUES) (byAddress[v.address] ||= []).push(v.id);
    const shared = Object.entries(byAddress).filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([['Sturegatan 4', ['sturecompagniet', 'hells-kitchen']]]);
  });

  it('inga två ställen har samma namn', () => {
    const names = VENUES.map((v) => v.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
