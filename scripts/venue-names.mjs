// Skriver supabase/functions/notify-favorites/venue-names.js och supabase/venues.sql ur VENUES i src/main.js. Kör efter
// varje ändring i VENUES, deploya notify-favorites och kör venues.sql mot databasen (reports_guard tar bara emot
// rapporter för ställena där); tests/notify.test.js och tests/hardening.test.js larmar när filerna glider isär.
import { writeFileSync } from 'node:fs';
import { VENUES } from '../tests/harness.js';

const names = Object.fromEntries(VENUES.map((v) => [v.id, v.name]));
writeFileSync(new URL('../supabase/functions/notify-favorites/venue-names.js', import.meta.url),
  '// Genererad av scripts/venue-names.mjs ur VENUES i src/main.js. Notisens titel tas härifrån, aldrig ur rapporten:\n' +
  '// venue_name är fri text från klienten.\n' +
  'export const VENUE_NAMES = ' + JSON.stringify(names, null, 2) + ';\n');

const q = (s) => "'" + s.replace(/'/g, "''") + "'";
const rows = Object.entries({ ...names, 'qbar-demo': 'Qbar demo' }).map(([id, name]) => '  (' + q(id) + ', ' + q(name) + ')');
writeFileSync(new URL('../supabase/venues.sql', import.meta.url),
  '-- Genererad av scripts/venue-names.mjs ur VENUES i src/main.js, plus demostället qbar-demo. reports_guard och\n' +
  '-- start_on_my_way tar bara emot ställena här, och rapportens venue_name tas härifrån. Kör efter varje ändring i VENUES:\n' +
  '--   npx -y supabase@latest db query --remote=awwmfsjsrjktekmbgadx --yes -f supabase/venues.sql\n' +
  'begin;\ndelete from public.venues;\ninsert into public.venues (id, name) values\n' + rows.join(',\n') + ';\ncommit;\n');
console.log(Object.keys(names).length + ' ställen');
