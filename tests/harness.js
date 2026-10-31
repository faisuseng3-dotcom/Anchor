// Testhjälpare — läser de rena funktionerna ur src/main.js utan att flytta någon kod.
//
// VARFÖR SÅ HÄR: modellfunktionerna har ingen `export` och ligger inne i src/main.js
// tillsammans med all DOM- och Mapbox-kod, som inte kan köras i Node. Den här filen klipper
// ut de block som saknar sidoeffekter och kör dem i en egen miljö.
//
// Det här är TILLFÄLLIG BYGGNADSSTÄLLNING. Syftet är att låsa fast dagens beteende INNAN
// koden flyttas. När modellen senare bor i src/model/ byts den här filen mot vanliga
// import-satser — samma testfall, samma förväntade värden. Går de från grönt till rött har
// flytten ändrat beteendet.
//
// Hjälparen klipper mellan ANKARE (funktions- och variabelnamn), inte radnummer. Flyttas ett
// block fungerar den ändå; byter ett ankare namn kastar den ett tydligt fel.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/main.js'), 'utf8');

function between(startAnchor, endAnchor) {
  const a = src.indexOf(startAnchor);
  if (a < 0) throw new Error(`harness: hittade inte ankaret "${startAnchor}" i src/main.js`);
  const b = src.indexOf(endAnchor, a);
  if (b < 0) throw new Error(`harness: hittade inte ankaret "${endAnchor}" efter "${startAnchor}"`);
  return src.slice(a, b);
}

// VENUES-arrayen, inklusive den avslutande klammern.
const venuesBlock = between('const VENUES = [', '\n    ];') + '\n    ];';

// Väntetidsmodellen: allt mellan takt-konstanterna och den första DOM-beroende funktionen.
const modelBlock = between('var PACE_RATE', 'function getStatusLabel');

// Fuzzy-sökningen. Stoppar före "── Utforska", som rör document.
const searchBlock = between('function _searchNorm', '// ── Utforska');

// Färskhetsradens text. exsumText tar sitt tillstånd som argument just för att vara testbar,
// så den går att nå utan DOM. Stoppar före renderExploreSummary, som rör document.
const exsumBlock = between('function exsumTimeSince', 'function renderExploreSummary');

// "Bäst nu" med sina två hjälpare. computeBestNow läser allReports och window._userPos; båda sätts via
// setTestReports nedan, så testet styr dem utan DOM.
const bestNowBlock = [
  between('function minutesToClose', '// A — vad som hänt'),
  between('function distanceKmTo', '// "650 m" under 950 m'),
  between('function computeBestNow', '// Raderna glider in')
].join('\n');

// Beroenden som modellblocket använder men som deklareras utanför det.
const shims = `
  function getVenueById(id) { return VENUES.find(function(v) { return v.id === id; }); }
  var allReports = [];
  var window = { _userPos: null };
  function setTestReports(reports, pos) { allReports = reports; window._userPos = pos || null; }
`;

const exported = [
  'VENUES', 'PACE_RATE', 'AHEAD_BUCKETS',
  'estimateWait', 'setWaitRange', 'formatWait', 'waitToStatus',
  'sessionRates', 'measureQueueRates', 'historicalRateFor', 'nightKey',
  'aheadBucket', 'isQueueReport', 'median', 'computeStatus', 'forecastWait',
  'getVenueById', '_searchNorm', 'venueScore', 'venueSearch',
  'exsumText', 'exsumTimeSince', 'computeBestNow', 'setTestReports'
];

const box = {};
new Function('exports', [
  venuesBlock, shims, modelBlock, searchBlock, exsumBlock, bestNowBlock,
  `Object.assign(exports, { ${exported.join(', ')} });`
].join('\n'))(box);

for (const name of exported) {
  if (box[name] === undefined) throw new Error(`harness: ${name} kom inte med ur src/main.js`);
}

export const {
  VENUES, PACE_RATE, AHEAD_BUCKETS,
  estimateWait, setWaitRange, formatWait, waitToStatus,
  sessionRates, measureQueueRates, historicalRateFor, nightKey,
  aheadBucket, isQueueReport, median, computeStatus, forecastWait,
  getVenueById, _searchNorm, venueScore, venueSearch,
  exsumText, exsumTimeSince, computeBestNow, setTestReports
} = box;

// ── Testdatabyggare ─────────────────────────────────────────────────────────

/** En fast tidpunkt så att testerna inte beror på när de körs. Fredag 2026-10-16, 23:00 lokal tid. */
export const NOW = new Date('2026-10-16T21:00:00.000Z').getTime();

/**
 * En rapport. `minsAgo` räknas bakåt från `at` (default NOW).
 * people_ahead ska vara ett av mittvärdena i AHEAD_BUCKETS: 0, 5, 17, 37, 60.
 */
export function report(venueId, minsAgo, peopleAhead, opts = {}) {
  return {
    venue_id: venueId,
    venue_name: opts.venueName || venueId,
    people_ahead: peopleAhead,
    report_type: opts.type || 'initial',
    queue_session: opts.session || null,
    queue_status: opts.status || null,
    user_id: opts.userId || 'test-user',
    created_at: new Date((opts.at || NOW) - minsAgo * 60000).toISOString()
  };
}

/**
 * En hel kö-session: en initial, valfria uppföljningar, valfri "entered".
 * `points` är [minuterSedan, antalFramför] räknat bakåt från NOW.
 */
export function session(venueId, id, points, opts = {}) {
  return points.map(([minsAgo, ahead], i) => report(venueId, minsAgo, ahead, {
    ...opts,
    session: id,
    type: i === 0 ? 'initial' : (ahead === 0 && opts.entered ? 'entered' : 'followup')
  }));
}

/** Väntetiden som texten visas, eller null när ingen skattning finns. */
export function waitText(venueId, reports, now = NOW, hist = null) {
  const est = estimateWait(venueId, reports, now, hist);
  return est ? formatWait(est) : null;
}
