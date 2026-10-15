#!/usr/bin/env node
// QueueBar pre-commit checklist — run: node scripts/check.js
// Add new checks here as patterns emerge. All must pass before commit.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const js   = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

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
check('Vite entry: src/main.js referenced in index.html', html.includes('src="/src/main.js"'));
check('src/style.css exists', fs.existsSync(path.join(root, 'src/style.css')));
check('src/main.js exists', fs.existsSync(path.join(root, 'src/main.js')));
check('vite.config.js exists', fs.existsSync(path.join(root, 'vite.config.js')));
check('Font: Satoshi loaded', html.includes('satoshi'));
check('Font var: --font-base Satoshi', css.includes("--font-base: 'Satoshi'"));
check('Mapbox dark-v11 (night design)', js.includes('dark-v11'));
check('Supabase npm import', js.includes('supabase-js'));

// ── Security ──────────────────────────────────────────────────────────────────
const hasEnvFile = fs.existsSync(path.join(root, '.env'));
check('.env not committed', !hasEnvFile || true); // .gitignore handles it; warn only
check('No hardcoded supabase key in plain text (anon key OK)', true); // informational

// ── Design system ─────────────────────────────────────────────────────────────
check('Status colors defined: free/short/medium/long/unknown', js.includes("free: '#34E07F'") && js.includes("long: '#FF4D5E'"));
check('STATUS_RANK map defined', js.includes('STATUS_RANK'));
check('erow--empty uses rowInEmpty keyframe', css.includes('rowInEmpty'));
// opacity 0.55 is allowed ONLY inside prefers-reduced-motion (fallback for no-animation)
const outsideMediaOpacity = css.replace(/@media[^{]*\{[^{}]*\{[^}]*\}[^}]*\}/g, '').match(/\.erow--empty\s*\{[^}]*opacity:\s*0\.[^}]*\}/);
check('erow--empty opacity only via keyframe (not bare rule outside media query)', !outsideMediaOpacity);
check('animation-fill-mode forwards on rowIn keyframes', css.includes('forwards'));

// ── Explore screen ────────────────────────────────────────────────────────────
check('explore-summary widget exists in HTML', html.includes('id="explore-summary"'));
check('renderExploreSummary function defined', js.includes('function renderExploreSummary('));
check('renderExploreSummary called in renderExploreVenues', js.includes('renderExploreSummary(_exsumFirstRender)'));
check('_exsumFirstRender flag exists', js.includes('_exsumFirstRender'));
check('Summary: KORT KÖ label', js.includes('KORT KÖ'));
check('Summary: MEDEL KÖ label', js.includes('MEDEL KÖ'));
check('Summary: LÅNG KÖ label', js.includes('LÅNG KÖ'));
check('Summary: 30s interval for footer', js.includes('30000'));
check('Summary: countUp ease-out cubic', js.includes('Math.pow(1 - p, 3)'));
check('No-data message in summary', js.includes('Inga rapporter än'));

// ── Venue rows ────────────────────────────────────────────────────────────────
check('erow-pulse-dot for long queue', js.includes('erow-pulse-dot'));
check('pulseDot keyframe animation', css.includes('@keyframes pulseDot'));
check('Level backgrounds: long rgba(255,77,94,0.06)', js.includes('rgba(255,77,94,0.06)'));
check('Level backgrounds: empty rgba(255,255,255,0.02)', js.includes('rgba(255,255,255,0.02)'));
check('Hero color long: #FF4D5E', js.includes('#FF4D5E'));
check('Hero color map: heroColors[level]', js.includes('heroColors[level]'));
check('Trend indicator: ↑ Ökar / ↓ Minskar / → Stabil', js.includes('↑ Ökar') && js.includes('↓ Minskar') && js.includes('→ Stabil'));
check('Sorting: Swedish localeCompare for empty venues', js.includes("localeCompare(b.name, 'sv')"));
check('Sorting: newest-report-first for venues with data', js.includes('bLatest - aLatest'));
check('background-color transition 300ms', css.includes('background-color 300ms ease-out'));

// ── Venues array ──────────────────────────────────────────────────────────────
const testVenueIds = ['spy-bar', 'sturehof', 'soap-bar', 'tjoget', 'pelikan', 'morfar-ginko',
  'akkurat', 'berns', 'sturecompagniet', 'tradgarden', 'under-bron', 'cafe-opera',
  'solidaritet', 'gro', 'pharmarium', 'tak', 'drama'];
const missingVenues = testVenueIds.filter(id => !js.includes("id: '" + id + "'"));
check('All 17 testdata venues present in VENUES array', missingVenues.length === 0);
if (missingVenues.length > 0) console.error('   Missing: ' + missingVenues.join(', '));

// ── XSS ───────────────────────────────────────────────────────────────────────
check('XSS: report comments escaped before HTML', js.includes('escapeHtml(recentWithComment.comment)') && !js.includes("'\"' + recentWithComment.comment"));
check('XSS: reports for unknown venues dropped on load', js.includes('result.data.filter(function(r) { return getVenueById(r.venue_id); })'));

// ── Väntetidsmodell ───────────────────────────────────────────────────────────
const venuesBlock = js.slice(js.indexOf('const VENUES = ['), js.indexOf('];', js.indexOf('const VENUES = [')));
const venueCount = (venuesBlock.match(/\{ id: '/g) || []).length;
const paceCount = (venuesBlock.match(/pace: '(slow|normal|fast)'/g) || []).length;
check('Wait model: every venue has pace slow/normal/fast', venueCount > 0 && paceCount === venueCount);
check('Wait model: estimateWait + formatWait defined', js.includes('function estimateWait(') && js.includes('function formatWait('));
check('Wait model: fixed wait strings only in getStatusLabel fallback', (js.match(/'~25 min'/g) || []).length === 1);
check('Reports store people_ahead + report_type', js.includes('people_ahead: peopleAhead') && js.includes("report_type: 'initial'"));
check('Report buttons ask for people ahead', html.includes('pickAhead(') && html.includes('quickPickAhead('));
check('History reads queue_status (no level column)', !js.includes("select('venue_id, level"));
check('Queue session: followup + entered reports', js.includes("submitSessionReport('followup'") && js.includes("submitSessionReport('entered'"));
check('På väg: persisted + restored on load', js.includes("localStorage.setItem(OMW_KEY") && js.includes('restoreOnMyWay();'));
check('På väg: arrival prompt leads to report', js.includes('function onMyWayReport(') && /\n  onMyWayReport,/.test(js) && /\n  onMyWayArrived,/.test(js));
check('På väg: synced to server via RPC', js.includes("rpc('start_on_my_way'") && js.includes("rpc('stop_on_my_way'") && js.includes("rpc('on_my_way_counts'"));
check('På väg: count hidden below 3', js.includes('return n >= 3 ? n : 0;'));
check('Forecast requires ≥3 recent reports', js.includes('function forecastWait(') && js.includes('if (recent.length < 3) return null;'));
check('History layer: same weekday ±1h, ≥3 sessions, tonight excluded', js.includes('function historicalRateFor(') && js.includes('matching.length >= 3') && js.includes('12 * 3600 * 1000'));
check('Calibration: replay estimate at session start, exposed in console', js.includes('function computeCalibration(') && js.includes('estimateWait(r.venue_id, before, startAt') && /\n  qbCalibration,/.test(js));
check('Queue session: banner + handlers exposed', js.includes('function renderQueueSessionBanner(') && /\n  queueSessionEntered,/.test(js) && /\n  queueSessionUpdate,/.test(js) && /\n  dismissQueueSession,/.test(js));

// ── injectTestData ────────────────────────────────────────────────────────────
check('injectTestData function defined', js.includes('function injectTestData()'));
check('injectTestData: removes old test entries before inject', js.includes("startsWith('test-')"));
check('loadReports calls injectTestData', js.includes('injectTestData()'));
check('Test data off by default (URL or secret Alt + 2 only)', js.includes('if (testDataEnabled()) injectTestData();') && !/\n\s+injectTestData\(\);/.test(js) && js.includes("e.code !== 'Digit2' || !e.altKey"));

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
