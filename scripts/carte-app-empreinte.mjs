// Régénère l'empreinte des libellés des pages (tests/support/carte-app-empreinte.json)
// — À LANCER APRÈS avoir mis à jour server/lib/support/carte-app.ts :
//   npm run carte:empreinte
// Voir scripts/lib/empreinte-pages.mjs.
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { empreintePages } from './lib/empreinte-pages.mjs';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cible = resolve(racine, 'tests', 'support', 'carte-app-empreinte.json');
let avant = {};
try { avant = JSON.parse(readFileSync(cible, 'utf8')); } catch { /* première fois */ }
const apres = empreintePages(racine);
const changees = Object.keys(apres).filter((f) => avant[f] !== apres[f]);
const disparues = Object.keys(avant).filter((f) => !(f in apres));
writeFileSync(cible, `${JSON.stringify(apres, null, 2)}\n`);
console.log(`${Object.keys(apres).length} pages · ${changees.length} empreinte(s) changée(s) · ${disparues.length} disparue(s) → ${cible}`);
for (const f of changees) console.log(`  ~ ${f}`);
for (const f of disparues) console.log(`  - ${f}`);
