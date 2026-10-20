#!/usr/bin/env node
// QueueBar kontextlint — kör: node scripts/check-context.js
//
// Fallerar om CLAUDE.md eller en SKILL.md beskriver QueueBar fel. De filerna är det
// enda en AI-agent läser innan den rör koden, och ett testsvit verifierar dem inte:
// `npm run verify` var grönt hela tiden när CLAUDE.md en gång tredubblades av en
// felriktad perl-ersättning, och lika grönt när en skill beskrev en `level`-kolumn
// som aldrig har funnits.
//
// VAD DEN INTE KAN GÖRA — läs det här innan du litar på ett grönt resultat:
// Den kontrollerar att namn, vägar och symboler FINNS. Den kan inte avgöra om ett
// påstående om dem är sant. "computeStatus() uses expires_at not created_at" passerar
// varje kontroll här: båda kolumnnamnen finns och är rätt stavade, och felet ligger i
// påståendet om vilken som används. Grönt betyder "inget som nämns är påhittat",
// inte "dokumentationen är sann".
//
// Ingen dependency. Deterministisk: samma träd ger samma utdata.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = js + '\n' + html;

// Dokumenten en agent läser. Lägg till nya här.
const SKILLS_DIR = path.join(root, '.claude/skills');
const DOCS = ['CLAUDE.md'];
if (fs.existsSync(SKILLS_DIR)) {
  for (const name of fs.readdirSync(SKILLS_DIR).sort()) {
    const rel = '.claude/skills/' + name + '/SKILL.md';
    if (fs.existsSync(path.join(root, rel))) DOCS.push(rel);
  }
}

const errors = [];
const warnings = [];

function error(file, line, what, fix) {
  errors.push('CONTEXT ERROR: ' + file + ':' + line + ' — ' + what + ' — ' + fix);
}
function warn(file, line, what, fix) {
  warnings.push('CONTEXT WARN:  ' + file + ':' + line + ' — ' + what + ' — ' + fix);
}

/** Ordgränssökning. Avsiktligt lös: det här är en docs-lint, inte en typkontroll. */
function mentionedInCode(name) {
  return new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b').test(code);
}

// ── 1 · Repo-vägar som nämns måste finnas ─────────────────────────────────────
const PATH_RE = /\b(?:src|tests|scripts|e2e|docs|\.claude|\.github|\.husky)\/[A-Za-z0-9_./*-]+/g;

// ── 2 · Backtickade funktionsnamn måste finnas i koden ────────────────────────
// Matchar `namn()` och `namn(argument)`. Inte `objekt.metod(` — punkten bryter mönstret,
// och `Object.assign(window, …)` ska inte slå.
const BACKTICK_RE = /`([^`\n]+)`/g;
const CALL_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\(.*\)$/;

// ── 3 · Påståenden som är kända fel ───────────────────────────────────────────
// `level` förbjuds INTE som ord: "screen-level decision" och "never a status level" är
// legitima, och `level` finns dessutom i koden som den visuella nivån i
// renderExploreVenueRow. Bara påståendet att det är en RAPPORTKOLUMN är fel.
const FORBIDDEN = [
  { re: /reports\.level\b/i,
    what: '"reports.level" beskriver en kolumn som inte finns',
    fix: 'rapporter har queue_status — se submitReport i src/main.js' },
  { re: /\blevel[\s-]?(?:column|kolumn)\b/i,
    what: 'en "level"-kolumn beskrivs',
    fix: 'kolumnen heter queue_status — se submitReport i src/main.js' },
  { re: /select\('[^']*\blevel\b/i,
    what: 'en select() med kolumnen "level"',
    fix: 'koden läser queue_status — se loadHistoricalRates i src/main.js' },
  { re: /\blevel\b\s*(?:is one of|är en av|måste vara)/i,
    what: 'validering av ett "level"-fält beskrivs',
    fix: 'användaren väljer people_ahead; queue_status deriveras av waitToStatus i src/main.js' },
  { re: /computeStatusRobust/,
    what: 'computeStatusRobust finns inte i koden',
    fix: 'modellen är estimateWait — personer framför delat med dörrtakt' },
  { re: /src\/lib\/waitModel\.js/,
    what: 'src/lib/waitModel.js finns inte längre',
    fix: 'modellen ligger i src/main.js mellan PACE_RATE och getStatusLabel' },
  { re: /\b(?:exploreList|waitTime)\.js\b/,
    what: 'den filen har aldrig funnits i repot',
    fix: 'all kod ligger i src/main.js' },
  { re: /[Ff]rontend:\s*`?index\.html`?/,
    what: 'index.html beskrivs som frontend',
    fix: 'all JS ligger i src/main.js; index.html är bara skalet' }
];

// ── 5 · Siffror och SHA:or som ruttnar ────────────────────────────────────────
// Sonderade mot hela dokumentmängden utan falsklarm. Hex-färger är sex tecken och
// träffas inte av SHA-mönstret; litteralen <sha> är inte hexadecimal.
// Flera radantalsmönster kan matcha samma text ("3 139 rader" träffar två av dem), så
// de rapporteras en gång per rad. SHA:n är ett SEPARAT problem och testas alltid — en
// rad kan innehålla både ett radantal och en commit-SHA, och då ska båda synas.
const LINES_FIX = 'ta bort siffran — radantal spärras maskinellt i scripts/check.js';
const SHA_FIX = 'ta bort SHA:n — använd ett funktionsnamn och grep i stället';
const LINE_COUNT_PATTERNS = [
  /\b\d{3,}[\s-]?rader\b/i,
  /\b\d[\s ]\d{3}[\s-]?rader\b/i,
  /\b\d+-raders/i,
  /\b\d{3,}[\s-]?lines\b/i
];
const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/;

// Radnummer som källhänvisning. CLAUDE.md kräver fil + funktionsnamn, aldrig radnummer.
// Varning, inte fel: de 15 som finns i dag kom in före regeln och ska bort i en egen
// commit. Gör om detta till error() när de är borta.
const LINE_REF_RE = /`:\d+`|\.(?:js|css|html):\d+/;

for (const rel of DOCS) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    const n = i + 1;

    // 1 · vägar
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(line)) !== null) {
      const p = m[0].replace(/[.,:;)\]`*]+$/, '');
      if (p.includes('*')) continue;               // glob, inte en väg
      if (!fs.existsSync(path.join(root, p))) {
        error(rel, n, '"' + p + '" finns inte i repot',
          'rätta vägen eller ta bort påståendet');
      }
    }

    // 2 · funktionsnamn
    BACKTICK_RE.lastIndex = 0;
    while ((m = BACKTICK_RE.exec(line)) !== null) {
      const call = CALL_RE.exec(m[1].trim());
      if (!call) continue;
      if (!mentionedInCode(call[1])) {
        error(rel, n, call[1] + '() nämns men finns inte i src/main.js eller index.html',
          'rätta namnet, eller ta bort påståendet om funktionen är borta');
      }
    }

    // 3 · förbjudna påståenden
    for (const f of FORBIDDEN) {
      if (f.re.test(line)) error(rel, n, f.what, f.fix);
    }

    // 5 · ruttnande siffror
    if (LINE_COUNT_PATTERNS.some((re) => re.test(line))) {
      error(rel, n, 'ett radantal som ruttnar', LINES_FIX);
    }
    if (SHA_PATTERN.test(line)) {
      error(rel, n, 'en commit-SHA som ruttnar', SHA_FIX);
    }

    if (LINE_REF_RE.test(line)) {
      warn(rel, n, 'radnummer används som källhänvisning',
        'använd fil + funktionsnamn — radnummer ruttnar');
    }
  });

  // 6b · dokumenterade kolumnnamn måste förekomma i koden
  const COLUMNS = ['venue_id', 'venue_name', 'queue_status', 'people_ahead', 'report_type',
    'queue_session', 'user_id', 'created_at', 'expires_at', 'comment'];
  lines.forEach((line, i) => {
    for (const col of COLUMNS) {
      if (new RegExp('`' + col + '`').test(line) && !mentionedInCode(col)) {
        error(rel, i + 1, 'kolumnen ' + col + ' nämns men förekommer inte i src/main.js',
          'kontrollera namnet mot submitReport och loadReports');
      }
    }
  });
}

// ── 4 · Obligatoriska symboler i first-principles-engineering ─────────────────
const FP = '.claude/skills/first-principles-engineering/SKILL.md';
const REQUIRED = ['queue_status', 'estimateWait', 'formatWait', 'venueWaitText', 'src/main.js'];
if (fs.existsSync(path.join(root, FP))) {
  const text = fs.readFileSync(path.join(root, FP), 'utf8');
  for (const sym of REQUIRED) {
    if (!text.includes(sym)) {
      error(FP, 1, sym + ' saknas i skillen',
        'skillen måste beskriva den nuvarande väntetidsvägen: estimateWait, formatWait, venueWaitText');
    }
  }
} else {
  error(FP, 1, 'skillen saknas', 'återställ den — den styr arkitektur- och säkerhetsarbete');
}

// ── 7 · /skill-referenser måste peka på en skill som finns ────────────────────
const skillNames = fs.existsSync(SKILLS_DIR) ? new Set(fs.readdirSync(SKILLS_DIR)) : new Set();
const SKILL_REF_RE = /`\/([a-z][a-z0-9-]+)`/g;
for (const rel of DOCS) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    let m;
    SKILL_REF_RE.lastIndex = 0;
    while ((m = SKILL_REF_RE.exec(line)) !== null) {
      if (!skillNames.has(m[1])) {
        error(rel, i + 1, '/' + m[1] + ' pekar på en skill som inte finns',
          'rätta namnet eller skapa .claude/skills/' + m[1] + '/SKILL.md');
      }
    }
  });
}

// ── 6a · Kolumner mot schema, om ett schema finns ─────────────────────────────
// Databasschemat är inte versionshanterat (Känd skuld 1), så det finns inget att
// jämföra mot. Den dagen någon checkar in supabase/migrations/*.sql blir den här
// kontrollen skarp — tills dess säger den uttryckligen att den hoppades över, i
// stället för att tysta räknas som godkänd.
const SQL_DIRS = ['supabase/migrations', 'db', 'migrations'];
const sqlFiles = [];
for (const d of SQL_DIRS) {
  const full = path.join(root, d);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith('.sql')) sqlFiles.push(path.join(d, f));
  }
}

// ── Resultat ──────────────────────────────────────────────────────────────────
console.log('Kontextlint: ' + DOCS.length + ' dokument granskade');
if (sqlFiles.length) {
  console.log('Schemajämförelse: ' + sqlFiles.length + ' SQL-filer hittade');
  const sql = sqlFiles.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const COLUMNS = ['venue_id', 'venue_name', 'queue_status', 'people_ahead', 'report_type',
    'queue_session', 'user_id', 'created_at', 'expires_at', 'comment'];
  for (const rel of DOCS) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const col of COLUMNS) {
        if (new RegExp('`' + col + '`').test(line) && !new RegExp('\\b' + col + '\\b').test(sql)) {
          error(rel, i + 1, 'kolumnen ' + col + ' nämns men finns inte i schemat',
            'rätta namnet, eller lägg till kolumnen i en migration');
        }
      }
    });
  }
} else {
  console.log('Schemajämförelse: SKIPPED — inget SQL-schema i repot (Känd skuld 1)');
}

if (warnings.length) {
  console.log('');
  warnings.forEach((w) => console.log(w));
  console.log('(' + warnings.length + ' varningar — fallerar inte bygget)');
}

console.log('');
console.log('─'.repeat(50));

if (errors.length) {
  errors.forEach((e) => console.error(e));
  console.error('');
  console.error(errors.length + ' kontextfel. Dokumentationen beskriver kod som inte finns.');
  process.exit(1);
}

console.log('0 kontextfel ✓');
