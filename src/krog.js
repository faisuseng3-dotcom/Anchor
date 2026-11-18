// Qbar för krogar (krog.html). Inloggning med e-postlänk (Supabase Auth), siffrorna från venue_stats() och raden via
// save_venue_note(), båda i supabase/migrations/20261118000000_krog.sql. Sidan räknar ingenting själv: databasen
// skickar bara sammanställda siffror för det inloggade stället, aldrig enskilda rapporter eller användar-id.
import { createClient } from '@supabase/supabase-js';
import { VENUE_NAMES } from '../supabase/functions/notify-favorites/venue-names.js';
import './style.css';
import './krog.css';

// Samma projekt och publika nyckel som src/main.js; vad nyckeln når bestäms av RLS och funktionerna.
const sb = createClient('https://awwmfsjsrjktekmbgadx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3d21mc2pzcmprdGVrbWJnYWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMjMwNzIsImV4cCI6MjEwNTY5OTA3Mn0.i5kS3ipzQ0mSzvVnjPbMiotVVUDYcpdTzQ5_HdCQCqI');

const $ = (id) => document.getElementById(id);
const DOWS = [1, 2, 3, 4, 5, 6, 0], DOW_LABELS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const DOW_DEF = ['söndagen', 'måndagen', 'tisdagen', 'onsdagen', 'torsdagen', 'fredagen', 'lördagen'];
const HOURS = [20, 21, 22, 23, 0, 1, 2, 3];
let venueId = null, timer = null;

// Kvällen börjar 06:00, som i appen (nightKey) och i venue_stats.
function nightStart() {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  d.setHours(6, 0, 0, 0);
  return d;
}

function showLogin(message) {
  clearInterval(timer);
  venueId = null;
  $('kr-dash').hidden = true;
  $('kr-login').hidden = false;
  $('kr-venue').hidden = $('kr-verified').hidden = $('kr-logout').hidden = true;
  $('kr-login-msg').textContent = message || '';
}

async function showDash() {
  if (!(await loadStats())) return;
  $('kr-login').hidden = true;
  $('kr-dash').hidden = false;
  loadNote();
  clearInterval(timer);
  timer = setInterval(loadStats, 60000);
}

// true när siffrorna kom. Ett fel efter att sidan visats behåller siffrorna och säger att de kan vara gamla.
async function loadStats() {
  const { data, error } = await sb.rpc('venue_stats');
  if (error) {
    if (/inget avtal/.test(error.message)) {
      await sb.auth.signOut();
      showLogin('Den här e-posten har inget avtal med Qbar.');
    } else if (!venueId) showLogin('Ingen kontakt med servern. Ladda om sidan för att försöka igen.');
    else $('kr-clock').textContent = 'Ingen kontakt med servern · siffrorna kan vara gamla';
    return false;
  }
  render(data);
  return true;
}

function render(s) {
  venueId = s.venue_id;
  // venue-names.js har bara ställen som syns i appen (VENUES utan HIDDEN_VENUES). Saknas id:t ser ingen raden eller
  // stället i Qbar: säg det i stället för att visa "Verifierat ställe".
  const listed = s.venue_id in VENUE_NAMES;
  $('kr-venue').textContent = VENUE_NAMES[s.venue_id] || s.venue_id;
  $('kr-verified').textContent = listed ? '✓ Verifierat ställe' : 'Syns inte i Qbar: dolt, borttaget eller demo';
  $('kr-verified').className = 'kr-pill ' + (listed ? 'kr-pill--ok' : 'kr-pill--warn');
  $('kr-venue').hidden = $('kr-verified').hidden = $('kr-logout').hidden = false;
  $('kr-clock').textContent = new Date().toLocaleString('sv-SE',
    { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // Kön just nu: samma text och färg som appen visar (venue_stats räknar som estimateWait).
  const now = $('kr-now');
  now.className = 'kr-big' + (s.now ? ' kr-st-' + s.now.status : '');
  const m = s.now && /^(.*?)\s*(min|i kö)$/.exec(s.now.text);
  if (m) {
    const unit = document.createElement('span');
    unit.className = 'kr-unit';
    unit.textContent = ' ' + m[2];
    now.replaceChildren(m[1], unit);
  } else now.textContent = s.now ? s.now.text : '–';
  $('kr-now-sub').textContent = !s.now ? 'Ingen rapport senaste 45 min'
    : s.now.fresh >= 2 ? s.now.fresh + ' rapporter senaste 20 min' : 'enligt senaste rapporten';

  // Som i appen syns antalet först från 3, så att en enskild person aldrig syns.
  $('kr-omw').textContent = s.on_way == null ? 'Färre än 3' : s.on_way;

  const lastNight = DOW_DEF[new Date(Date.now() - 6 * 3600 * 1000).getDay()];
  const diff = s.reports_tonight - s.reports_last_week;
  $('kr-count').textContent = s.reports_tonight;
  $('kr-count-sub').textContent = (diff > 0 ? '+' + diff + ' mot' : diff < 0 ? '−' + -diff + ' mot' : 'lika många som') +
    ' förra ' + lastNight + ' samma tid';
  $('kr-lastweek-label').textContent = 'Förra ' + lastNight;

  drawChart(s.tonight || [], s.last_week || []);
  drawHeat(s.heat || []);
}

// Minuter var 15:e minut 20:00–03:00 (29 punkter). null = appen visade inga minuter då, och linjen bryts.
function drawChart(tonight, lastWeek) {
  const W = 640, H = 220, L = 30, R = 24, T = 10, B = 24, N = 29;
  const x = (i) => (L + i * (W - L - R) / (N - 1)).toFixed(1);
  const y = (v) => (T + (1 - Math.min(v, 60) / 60) * (H - T - B)).toFixed(1);
  const path = (vals) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i) + ' ' + y(v); pen = true; });
    return d;
  };
  let svg = '';
  [0, 15, 30, 45, 60].forEach((v) => {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="0" y="${+y(v) + 4}">${v}</text>`;
  });
  HOURS.forEach((h, k) => { svg += `<text x="${x(k * 4)}" y="${H - 4}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`; });
  svg += `<path class="last" d="${path(lastWeek)}"/><path class="now" d="${path(tonight)}"/>`;
  tonight.forEach((v, i) => { if (v != null) svg += `<circle cx="${x(i)}" cy="${y(v)}" r="2.5"/>`; });
  $('kr-chart').innerHTML = svg;
  $('kr-chart-empty').hidden = tonight.some((v) => v != null);
}

function drawHeat(cells) {
  const at = {};
  cells.forEach((c) => { at[c.dow + ':' + c.hour] = c; });
  let html = '<div></div>' + HOURS.map((h) => `<div class="kr-hh">${String(h).padStart(2, '0')}</div>`).join('');
  DOWS.forEach((d, r) => {
    html += `<div class="kr-dd">${DOW_LABELS[r]}</div>` + HOURS.map((h) => {
      const c = at[d + ':' + h];
      return c ? `<div class="kr-cell kr-st-${c.status}" title="${DOW_LABELS[r]} ${h}:00 · ${c.mins} min">${c.mins}</div>`
        : '<div class="kr-cell" title="Ingen data"></div>';
    }).join('');
  });
  $('kr-heat').innerHTML = html;
  $('kr-heat-empty').hidden = cells.length > 0;
}

async function loadNote() {
  const { data, error } = await sb.from('venue_notes').select('entry, guestlist, tonight, updated_at')
    .eq('venue_id', venueId).maybeSingle();
  if (error) { $('kr-note-msg').textContent = 'Kunde inte läsa raden: ' + error.message; return; }
  $('kr-entry').value = (data && data.entry) || '';
  $('kr-guestlist').value = (data && data.guestlist) || '';
  $('kr-tonight').value = (data && data.tonight) || '';
  $('kr-note-msg').textContent = !data ? '' : new Date(data.updated_at) >= nightStart() ? 'Syns i Qbar i kväll, till 06:00.'
    : 'Syns inte nu: sparad ' + new Date(data.updated_at).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) +
      '. Spara för att visa den i kväll.';
}

$('kr-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('kr-note-msg').textContent = 'Sparar…';
  const { error } = await sb.rpc('save_venue_note',
    { p_entry: $('kr-entry').value, p_guestlist: $('kr-guestlist').value, p_tonight: $('kr-tonight').value });
  if (error) $('kr-note-msg').textContent = 'Gick inte att spara: ' + error.message;
  else loadNote();
});

$('kr-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('kr-login-msg').textContent = 'Skickar…';
  // shouldCreateUser: false: bara konton som lagts upp för ett ställe med avtal får en länk.
  const { error } = await sb.auth.signInWithOtp({ email: $('kr-email').value.trim(),
    // Fast adress: den måste stå under Redirect URLs i Supabase Auth, och /krog (vercel.json) är samma sida.
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/krog.html' } });
  $('kr-login-msg').textContent = !error ? 'Kolla mejlen och tryck på länken.'
    : /signup|not allowed|not found/i.test(error.message) ? 'Den adressen har inget avtal med Qbar.'
    : 'Gick inte att skicka: ' + error.message;
});

$('kr-logout').addEventListener('click', () => sb.auth.signOut());

// Anropa inte Supabase direkt i lyssnaren (supabase-js kan låsa sig); därför setTimeout.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
  setTimeout(() => (session ? showDash() : showLogin()));
});
