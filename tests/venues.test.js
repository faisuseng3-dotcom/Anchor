// VENUES-arrayens integritet. Ställena ligger i kod, inte i databasen, och det finns
// ingen validering någonstans — ett fält som glöms eller en koordinat som är fel upptäcks
// i dag först av en användare som står på fel gata.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VENUES, HIDDEN_VENUES, PACE_RATE, getVenueById, closingTonight, isClosed } from './harness.js';

const FIELDS = ['id', 'name', 'address', 'area', 'type', 'lat', 'lng', 'closing', 'pace'];

describe('VENUES — struktur', () => {
  // Vakt mot trunkering: src/main.js har kapats två gånger av AI-redigeringar.
  // 310 rader (28 handskrivna + 280 från OSM + 2 tillagda för hand) minus 16 dolda i HIDDEN_VENUES.
  it('innehåller 294 synliga ställen', () => {
    expect(VENUES).toHaveLength(294);
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

  it('closing är HH:MM eller null, eller sju sådana (måndag–söndag) där false är stängt hela kvällen', () => {
    // null: OSM saknar öppettider. Hellre ingen "Stängt" än en gissad som visar ett öppet ställe som stängt.
    const ok = (c) => c === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(c);
    for (const v of VENUES) {
      if (!Array.isArray(v.closing)) { expect(ok(v.closing), v.id).toBe(true); continue; }
      expect(v.closing, v.id).toHaveLength(7);
      for (const c of v.closing) expect(c === false || ok(c), `${v.id}: ${c}`).toBe(true);
      expect(new Set(v.closing).size, `${v.id}: samma alla dagar ska skrivas som en tid`).toBeGreaterThan(1);
    }
  });

  // closing per veckodag: en fast tid räknas mot den riktiga klockan, så den måste ställas.
  afterEach(() => vi.useRealTimers());
  const club = { closing: [false, false, '05:00', '05:00', '05:00', '05:00', false] }; // onsdag–lördag
  const at = (iso) => vi.useFakeTimers({ now: new Date(iso) });

  it('natten hör till dagen den började: lördag 02:00 är fredagens natt', () => {
    at('2026-10-17T02:00:00+02:00'); // lördag
    expect(closingTonight(club)).toBe('05:00');
    expect(isClosed(club)).toBe(false);
  });

  it('en kväll stället inte öppnar är det stängt hela kvällen, även efter midnatt', () => {
    at('2026-10-18T23:00:00+02:00'); // söndag
    expect(isClosed(club)).toBe(true);
    at('2026-10-19T02:00:00+02:00'); // måndag natt = söndagens natt
    expect(isClosed(club)).toBe(true);
  });

  it('en okänd dag är aldrig stängd', () => {
    at('2026-10-16T23:00:00+02:00'); // fredag
    expect(isClosed({ closing: [null, null, null, null, null, '01:00', null] })).toBe(false);
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
