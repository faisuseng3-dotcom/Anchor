#!/usr/bin/env node
// Hämtar barer/pubar/nattklubbar i Stockholms innerstad från OpenStreetMap (Overpass)
// och jämför med VENUES i src/main.js. Skriver data/ men ändrar aldrig src/.
// Kör: node scripts/fetch-osm-venues.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const BBOX = { south: 59.28, west: 17.98, north: 59.36, east: 18.12 };
const SANITY = { latMin: 59.2, latMax: 59.4, lonMin: 17.9, lonMax: 18.2 };
const DUP_METERS = 50;
const DRIFT_METERS = 75;

// Bara servrar med global data. overpass.osm.ch täcker bara Schweiz och svarar
// med noll träffar på en Stockholmsfråga, vilket ser ut som ett lyckat anrop.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const ATTEMPTS_PER_ENDPOINT = 3;

// OSM-namn → våra nio områden. Allt annat blir "oklart".
const AREA_ALIASES = {
  'slakthusområdet': 'Slakthusområdet',
  'slakthusomradet': 'Slakthusområdet',
  'hammarby sjöstad': 'Hammarby Sjöstad',
  'hammarby sjostad': 'Hammarby Sjöstad',
  'vasastan': 'Vasastan',
  'vasastaden': 'Vasastan',
  'kungsholmen': 'Kungsholmen',
  'gamla stan': 'Gamla Stan',
  'skeppsholmen': 'Skeppsholmen/Blasieholmen',
  'blasieholmen': 'Skeppsholmen/Blasieholmen',
  'södermalm': 'Södermalm',
  'sodermalm': 'Södermalm',
  'norrmalm': 'Norrmalm',
  'östermalm': 'Östermalm/Stureplan',
  'ostermalm': 'Östermalm/Stureplan'
};

const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

const QUERY_VENUES = `[out:json][timeout:180];
nwr["amenity"~"^(bar|pub|nightclub)$"](${bbox});
out center tags;`;

const QUERY_AREAS = `[out:json][timeout:180];
(
  way["place"~"^(suburb|neighbourhood|quarter|borough)$"](${bbox});
  relation["place"~"^(suburb|neighbourhood|quarter|borough)$"](${bbox});
);
out geom tags;`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(query, label, { minElements = 1 } = {}) {
  let lastErr;
  for (const url of ENDPOINTS) {
    const host = new URL(url).host;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_ENDPOINT; attempt++) {
      try {
        process.stdout.write(`  ${label}: ${host} (försök ${attempt}) … `);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'QueueBar/1.0 (venue research; github.com/faisuseng3-dotcom/Anchor)'
          },
          body: new URLSearchParams({ data: query })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const n = json.elements?.length ?? 0;
        // Ett tomt svar på en storstadsfråga betyder fel server, inte tom stad.
        if (n < minElements) throw new Error(`bara ${n} element — servern saknar troligen svensk data`);
        console.log(`${n} element`);
        return json;
      } catch (err) {
        console.log(`misslyckades (${err.message})`);
        lastErr = err;
        if (attempt < ATTEMPTS_PER_ENDPOINT) await sleep(attempt * 5000);
      }
    }
  }
  throw new Error(`Alla Overpass-servrar misslyckades för ${label}. Sist: ${lastErr?.message}. Servrarna är ofta överbelastade — vänta några minuter och kör igen.`);
}

function haversine(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon, yi = ring[i].lat, xj = ring[j].lon, yj = ring[j].lat;
    const hit = (yi > pt.lat) !== (yj > pt.lat) &&
      pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function buildAreas(raw) {
  const areas = [];
  for (const el of raw.elements) {
    const name = el.tags?.name;
    if (!name) continue;
    const mapped = AREA_ALIASES[name.toLowerCase().trim()];
    if (!mapped) continue;
    const rings = [];
    if (el.type === 'way' && el.geometry?.length > 2) rings.push(el.geometry);
    if (el.type === 'relation') {
      for (const m of el.members || []) {
        if (m.role !== 'inner' && m.geometry?.length > 2) rings.push(m.geometry);
      }
    }
    if (rings.length) areas.push({ name: mapped, osm: `${el.type}/${el.id}`, rings });
  }
  return areas;
}

function areaFor(pt, areas) {
  for (const a of areas) {
    if (a.rings.some(r => pointInRing(pt, r))) return a.name;
  }
  return 'oklart';
}

// Jämför namn utan skiftläge, skiljetecken och vanliga suffix.
function normName(n) {
  return n.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(bar|pub|restaurang|restaurant|club|klubb|nightclub|stockholm|sthlm)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function parseExistingVenues() {
  const src = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const start = src.indexOf('const VENUES = [');
  if (start === -1) throw new Error('Hittade inte VENUES i src/main.js');
  const block = src.slice(start, src.indexOf('];', start));
  const out = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*(?:'([^']*)'|"([^"]*)")[^}]*?lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(block))) {
    out.push({ id: m[1], name: m[2] ?? m[3], lat: parseFloat(m[4]), lon: parseFloat(m[5]) });
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log(`Hämtar från Overpass (bbox ${bbox})`);
  const rawVenues = await overpass(QUERY_VENUES, 'ställen', { minElements: 50 });
  await sleep(3000);
  const rawAreas = await overpass(QUERY_AREAS, 'stadsdelar', { minElements: 1 });

  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'osm_raw.json'), JSON.stringify({ venues: rawVenues, areas: rawAreas }, null, 2));

  const areas = buildAreas(rawAreas);
  console.log(`\nStadsdelspolygoner: ${areas.length} (${[...new Set(areas.map(a => a.name))].join(', ') || 'inga'})`);

  const stats = {
    raw: rawVenues.elements.length,
    byType: {}, noName: 0, noAddress: 0, noHours: 0,
    outsideBbox: 0, duplicates: 0, flaggedClosed: 0
  };

  const rows = [];
  for (const el of rawVenues.elements) {
    const t = el.tags || {};
    const amenity = t.amenity;
    stats.byType[amenity] = (stats.byType[amenity] || 0) + 1;

    if (!t.name) { stats.noName++; continue; }

    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    if (lat === null || lon === null) { stats.noName++; continue; }
    if (lat < SANITY.latMin || lat > SANITY.latMax || lon < SANITY.lonMin || lon > SANITY.lonMax) {
      stats.outsideBbox++;
      continue;
    }

    const street = t['addr:street'] || null;
    const hnr = t['addr:housenumber'] || null;
    const address = street ? (hnr ? `${street} ${hnr}` : street) : null;
    if (!address) stats.noAddress++;
    if (!t.opening_hours) stats.noHours++;

    const closedHints = Object.keys(t).filter(k =>
      k.startsWith('disused:') || k.startsWith('was:') || k.startsWith('abandoned:') || k.startsWith('removed:')
    );
    if (t.opening_hours === 'off') closedHints.push('opening_hours=off');
    if (closedHints.length) stats.flaggedClosed++;

    rows.push({
      osm_id: `${el.type}/${el.id}`,
      name: t.name,
      type: amenity,
      lat, lon,
      address,
      street, housenumber: hnr,
      postcode: t['addr:postcode'] || null,
      opening_hours: t.opening_hours || null,
      website: t.website || t['contact:website'] || null,
      area: areaFor({ lat, lon }, areas),
      possibly_closed: closedHints.length ? closedHints.join(', ') : null,
      tag_count: Object.keys(t).length
    });
  }

  // Dubbletter: samma normaliserade namn inom 50 m. Behåll den med flest taggar.
  rows.sort((a, b) => b.tag_count - a.tag_count);
  const kept = [];
  for (const r of rows) {
    const key = normName(r.name);
    const dup = kept.find(k => normName(k.name) === key && haversine(k, r) <= DUP_METERS);
    if (dup) {
      stats.duplicates++;
      (dup.merged_osm_ids ||= []).push(r.osm_id);
      continue;
    }
    kept.push(r);
  }
  kept.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  const existing = parseExistingVenues();
  // Matcha bara på namn. Enbart närhet räcker inte: vid Stureplan ligger flera
  // olika ställen inom 60 m, och då skulle nya ställen tyst försvinna.
  const matched = new Map();
  for (const e of existing) {
    const key = normName(e.name);
    let best = null, bestD = Infinity;
    for (const k of kept) {
      if (normName(k.name) !== key) continue;
      const d = haversine(e, k);
      if (d < 400 && d < bestD) { best = k; bestD = d; }
    }
    if (best) matched.set(e.id, { osm: best, meters: Math.round(bestD) });
  }

  const matchedIds = new Set([...matched.values()].map(m => m.osm.osm_id));
  const newVenues = kept.filter(k => !matchedIds.has(k.osm_id));
  for (const n of newVenues) {
    const near = existing
      .map(e => ({ name: e.name, meters: Math.round(haversine(e, n)) }))
      .filter(x => x.meters <= 60)
      .sort((a, b) => a.meters - b.meters)[0];
    if (near) n.near_existing = `${near.name} (${near.meters} m)`;
  }

  const drifted = existing
    .filter(e => matched.has(e.id) && matched.get(e.id).meters > DRIFT_METERS)
    .map(e => ({ id: e.id, name: e.name, meters: matched.get(e.id).meters, osm: matched.get(e.id).osm }));

  const notFound = existing.filter(e => !matched.has(e.id)).map(e => {
    const near = kept
      .map(k => ({ k, meters: Math.round(haversine(e, k)) }))
      .filter(x => x.meters <= 60)
      .sort((a, b) => a.meters - b.meters)[0];
    return {
      id: e.id, name: e.name,
      possible_rename: near ? `${near.k.name} (${near.meters} m, ${near.k.osm_id})` : null
    };
  });

  const perArea = {};
  for (const k of kept) {
    perArea[k.area] ||= { bar: 0, pub: 0, nightclub: 0, total: 0 };
    perArea[k.area][k.type]++;
    perArea[k.area].total++;
  }

  const report = {
    generated_at: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API — © OpenStreetMap contributors, ODbL',
    bbox: BBOX,
    stats, per_area: perArea,
    kept_count: kept.length,
    comparison: {
      existing_count: existing.length,
      new_in_osm: newVenues.length,
      coordinate_drift_over_75m: drifted,
      existing_not_found_in_osm: notFound
    }
  };

  writeFileSync(join(DATA, 'venues_candidates.json'),
    JSON.stringify({ report, venues: kept }, null, 2));

  const cols = ['osm_id', 'name', 'type', 'lat', 'lon', 'address', 'postcode', 'opening_hours', 'website', 'area', 'possibly_closed'];
  writeFileSync(join(DATA, 'venues_candidates.csv'),
    [cols.join(','), ...kept.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n');

  console.log('\n──────── RAPPORT ────────');
  console.log(`Råa träffar:        ${stats.raw}`);
  console.log(`  per typ:          ${Object.entries(stats.byType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`Utan namn:          ${stats.noName} (borttagna)`);
  console.log(`Utanför koordinatkontroll: ${stats.outsideBbox} (borttagna)`);
  console.log(`Dubbletter:         ${stats.duplicates} (sammanslagna)`);
  console.log(`Kvar:               ${kept.length}`);
  console.log(`  saknar adress:    ${stats.noAddress}`);
  console.log(`  saknar öppettider:${stats.noHours}`);
  console.log(`  flaggade nedlagda:${stats.flaggedClosed}`);
  console.log('\nPer stadsdel:');
  for (const [a, c] of Object.entries(perArea).sort((x, y) => y[1].total - x[1].total)) {
    console.log(`  ${a.padEnd(26)} ${String(c.total).padStart(4)}  (bar ${c.bar}, pub ${c.pub}, klubb ${c.nightclub})`);
  }
  console.log(`\nJämfört med våra ${existing.length} ställen:`);
  console.log(`  (a) nya i OSM:                  ${newVenues.length}`);
  console.log(`  (b) avviker mer än 75 m:        ${drifted.length}`);
  drifted.forEach(d => console.log(`        ${d.name}: ${d.meters} m → ${d.osm.address || d.osm.name} (${d.osm.lat}, ${d.osm.lon})`));
  console.log(`  (c) hittades inte i OSM:        ${notFound.length}`);
  notFound.forEach(n => console.log(`        ${n.name} (${n.id})${n.possible_rename ? ` — nära: ${n.possible_rename}` : ''}`));
  const nearNew = newVenues.filter(n => n.near_existing);
  if (nearNew.length) {
    console.log(`\n  Nya ställen inom 60 m av ett befintligt (kontrollera dubbletter): ${nearNew.length}`);
    nearNew.slice(0, 15).forEach(n => console.log(`        ${n.name} — ${n.near_existing}`));
    if (nearNew.length > 15) console.log(`        … och ${nearNew.length - 15} till (se JSON)`);
  }
  console.log('\nSkrivet: data/venues_candidates.json, data/venues_candidates.csv, data/osm_raw.json');
}

main().catch(err => { console.error('\nFEL:', err.message); process.exit(1); });
