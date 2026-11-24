// Hämtar Satoshi (400, 500, 700) till public/fonts/ före dev och bygge (npm-hookarna predev och prebuild). Typsnittet
// serveras från vår egen domän och ligger i iOS-appen, så att besökarnas IP-adresser inte går till Fontshare (Indian
// Type Foundry, Indien). Filerna checkas inte in: licensen (ITF FFL) tillåter att vi är värd för dem på egen sajt och i
// egen app, men inte att de sprids, och repot är publikt. Redan hämtade filer hämtas inte igen.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const DIR = new URL('../public/fonts/', import.meta.url);
const WEIGHTS = [400, 500, 700];
const file = (w) => new URL('satoshi-' + w + '.woff2', DIR);

if (!WEIGHTS.every((w) => existsSync(file(w)))) {
  const css = await (await fetch('https://api.fontshare.com/v2/css?f[]=satoshi@' + WEIGHTS.join(','))).text();
  mkdirSync(DIR, { recursive: true });
  for (const w of WEIGHTS) {
    const block = css.split('@font-face').find((b) => b.includes('font-weight: ' + w + ';'));
    const url = block && /url\('(\/\/[^']+\.woff2)'\)/.exec(block);
    if (!url) throw new Error('Satoshi ' + w + ' saknas i Fontshares svar');
    const res = await fetch('https:' + url[1]);
    if (!res.ok) throw new Error('Satoshi ' + w + ': HTTP ' + res.status);
    writeFileSync(file(w), Buffer.from(await res.arrayBuffer()));
  }
  console.log('Satoshi hämtad till public/fonts/');
}
