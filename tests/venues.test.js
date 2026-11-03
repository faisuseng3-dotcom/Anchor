// VENUES-arrayens integritet. Ställena ligger i kod, inte i databasen, och det finns
// ingen validering någonstans — ett fält som glöms eller en koordinat som är fel upptäcks
// i dag först av en användare som står på fel gata.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { VENUES, HIDDEN_VENUES, PACE_RATE, getVenueById } from './harness.js';

const FIELDS = ['id', 'name', 'address', 'area', 'type', 'lat', 'lng', 'closing', 'pace'];

describe('VENUES — struktur', () => {
  // Vakt mot trunkering: src/main.js har kapats två gånger av AI-redigeringar.
  // 308 rader (28 handskrivna + 280 från OSM) minus 16 dolda i HIDDEN_VENUES.
  it('innehåller 292 synliga ställen', () => {
    expect(VENUES).toHaveLength(292);
  });

  it('varje dolt id finns som rad och syns inte', () => {
    // Ett felstavat id i HIDDEN_VENUES döljer ingenting, och stället står kvar på kartan.
    const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    for (const id of Object.keys(HIDDEN_VENUES)) {
      expect(src, `${id} finns inte i VENUES`).toContain(`{ id: '${id}',`);
      expect(getVenueById(id), `${id} syns fortfarande`).toBeUndefined();
    }
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
  // Täta kvarter (Stureplan, Gamla stan) har ställen några meter isär. Kartan klustrar dem upp till zoom 13;
  // längre in ritas nålarna med icon-allow-overlap. Exakt samma punkt går aldrig att isär med zoom.
  it('inga två ställen delar exakt samma koordinat', () => {
    const points = VENUES.map((v) => `${v.lat},${v.lng}`);
    expect(new Set(points).size).toBe(points.length);
  });
  it('inga två ställen har samma namn', () => {
    const names = VENUES.map((v) => v.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
