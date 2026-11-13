// Skriver supabase/functions/notify-favorites/venue-names.js ur VENUES i src/main.js. Kör efter varje ändring i VENUES
// och deploya notify-favorites; tests/notify.test.js larmar när filen glider isär.
import { writeFileSync } from 'node:fs';
import { VENUES } from '../tests/harness.js';

const names = Object.fromEntries(VENUES.map((v) => [v.id, v.name]));
writeFileSync(new URL('../supabase/functions/notify-favorites/venue-names.js', import.meta.url),
  '// Genererad av scripts/venue-names.mjs ur VENUES i src/main.js. Notisens titel tas härifrån, aldrig ur rapporten:\n' +
  '// venue_name är fri text från klienten.\n' +
  'export const VENUE_NAMES = ' + JSON.stringify(names, null, 2) + ';\n');
console.log(Object.keys(names).length + ' ställen');
