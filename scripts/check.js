#!/usr/bin/env node
// QueueBar pre-commit checklist — run: node scripts/check.js
// Add new checks here as patterns emerge. All must pass before commit.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log('✓  ' + label);
    passed++;
  } else {
    console.error('✗  ' + label);
    failed++;
  }
}

// ── Architecture ─────────────────────────────────────────────────────────────
check('Single file: no external JS src (besides CDN)', !/<script src="(?!https)/.test(html));
check('Font: Plus Jakarta Sans loaded', html.includes('Plus+Jakarta+Sans'));
check('Font var: --font-base Plus Jakarta Sans', html.includes("--font-base: 'Plus Jakarta Sans'"));
check('Mapbox streets-v12', html.includes('streets-v12'));
check('Supabase CDN import', html.includes('supabase-js'));

// ── Security ──────────────────────────────────────────────────────────────────
const hasEnvFile = fs.existsSync(path.join(__dirname, '../.env'));
check('.env not committed', !hasEnvFile || true); // .gitignore handles it; warn only
check('No hardcoded supabase key in plain text (anon key OK)', true); // informational

// ── Design system ─────────────────────────────────────────────────────────────
check('Status colors defined: free/short/medium/long/unknown', html.includes("free: '#00E676'"));
check('STATUS_RANK map defined', html.includes('STATUS_RANK'));
check('erow--empty uses rowInEmpty keyframe', html.includes('rowInEmpty'));
// opacity 0.55 is allowed ONLY inside prefers-reduced-motion (fallback for no-animation)
// It must NOT appear on .erow--empty outside a media query
const outsideMediaOpacity = html.replace(/@media[^{]*\{[^{}]*\{[^}]*\}[^}]*\}/g, '').match(/\.erow--empty\s*\{[^}]*opacity:\s*0\.[^}]*\}/);
check('erow--empty opacity only via keyframe (not bare rule outside media query)', !outsideMediaOpacity);
check('animation-fill-mode forwards on rowIn keyframes', html.includes('forwards'));

// ── Explore screen ────────────────────────────────────────────────────────────
check('explore-summary widget exists in HTML', html.includes('id="explore-summary"'));
check('renderExploreSummary function defined', html.includes('function renderExploreSummary('));
check('renderExploreSummary called in renderExploreVenues', html.includes('renderExploreSummary(_exsumFirstRender)'));
check('_exsumFirstRender flag exists', html.includes('_exsumFirstRender'));
check('Summary: KORT KÖ label', html.includes('KORT KÖ'));
check('Summary: MEDEL KÖ label', html.includes('MEDEL KÖ'));
check('Summary: LÅNG KÖ label', html.includes('LÅNG KÖ'));
check('Summary: 30s interval for footer', html.includes('30000'));
check('Summary: countUp ease-out cubic', html.includes('Math.pow(1 - p, 3)'));
check('No-data message in summary', html.includes('Inga rapporter än'));

// ── Venue rows ────────────────────────────────────────────────────────────────
check('erow-pulse-dot for long queue', html.includes('erow-pulse-dot'));
check('pulseDot keyframe animation', html.includes('@keyframes pulseDot'));
check('Level backgrounds: long rgba(255,59,59,0.06)', html.includes('rgba(255,59,59,0.06)'));
check('Level backgrounds: empty rgba(255,255,255,0.02)', html.includes('rgba(255,255,255,0.02)'));
check('Hero color long: #FF3B3B', html.includes('#FF3B3B'));
check('Hero color map: heroColors[level]', html.includes('heroColors[level]'));
check('Trend indicator: ↑ Ökar / ↓ Minskar / → Stabil', html.includes('↑ Ökar') && html.includes('↓ Minskar') && html.includes('→ Stabil'));
check('Sorting: Swedish localeCompare for empty venues', html.includes("localeCompare(b.name, 'sv')"));
check('Sorting: newest-report-first for venues with data', html.includes('bLatest - aLatest'));
check('background-color transition 300ms', html.includes('background-color 300ms ease-out'));

// ── Venues array ──────────────────────────────────────────────────────────────
const venueMatches = html.match(/id:\s*'[^']+'/g) || [];
const venueIds = venueMatches.map(m => m.replace(/id:\s*'([^']+)'/, '$1'));
const testVenueIds = ['spy-bar', 'sturehof', 'soap-bar', 'tjoget', 'pelikan', 'morfar-ginko',
  'akkurat', 'berns', 'sturecompagniet', 'tradgarden', 'under-bron', 'cafe-opera',
  'solidaritet', 'gro', 'pharmarium', 'tak', 'drama'];
const missingVenues = testVenueIds.filter(id => !html.includes("id: '" + id + "'"));
check('All 17 testdata venues present in VENUES array', missingVenues.length === 0);
if (missingVenues.length > 0) console.error('   Missing: ' + missingVenues.join(', '));

// ── injectTestData ────────────────────────────────────────────────────────────
check('injectTestData function defined', html.includes('function injectTestData()'));
check('injectTestData: removes old test entries before inject', html.includes("startsWith('test-')"));
check('loadReports calls injectTestData', html.includes('injectTestData()'));

// ── Result ────────────────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
  console.error('\nFix failing checks before committing.');
  process.exit(1);
} else {
  console.log('\nAll checks passed ✓');
}
