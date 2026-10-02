// Porte dans le dépôt les scripts de vérification sur le vrai site (import de l'outillage, sorties hors dépôt).
import { readFileSync, writeFileSync } from 'node:fs';
const src = 'D:/lume-uiaudit/outils/prod/';
const dst = 'D:/lume-uiaudit/wt-lumi/scripts/qa/automations-prod/';
const fichiers = [
  ['p4-lot1.mjs', '10-menus-apercu-editeur.mjs'],
  ['p5-lot1b.mjs', '11-diagnostic-variables.mjs'],
  ['p6-lot2.mjs', '20-liste-editeur-modeles.mjs'],
  ['p8-tablette.mjs', '30-tablette-liste.mjs'],
  ['p9-entete-tablette.mjs', '31-tablette-entete.mjs'],
  ['p10-editeur-tablette.mjs', '32-tablette-editeur.mjs'],
];
for (const [de, vers] of fichiers) {
  let s = readFileSync(src + de, 'utf8');
  if (!s.includes("from '../nav-prod.mjs'")) throw new Error(`import introuvable : ${de}`);
  s = s.replace("from '../nav-prod.mjs'", "from './outils.mjs'");
  s = s.replace(/^\/\/ Passe prod, /m, '// Vrai site, ');
  if (de === 'p10-editeur-tablette.mjs') {
    s = s.replace("import { writeFileSync } from 'node:fs';", "import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';");
    s = s.replace("import { ouvrir, capture, inventaire, admin, ORG } from './outils.mjs';", "import { ouvrir, capture, inventaire, admin, ORG, SORTIES } from './outils.mjs';");
    s = s.replace("writeFileSync('D:/lume-uiaudit/sorties/editeur-tablette.json', JSON.stringify(bilan, null, 2));", "writeFileSync(join(SORTIES, 'editeur-tablette.json'), JSON.stringify(bilan, null, 2));");
    if (s.includes('D:/lume-uiaudit')) throw new Error('chemin local restant dans p10');
  }
  if (s.includes('D:/lume-uiaudit')) throw new Error(`chemin local restant : ${de}`);
  writeFileSync(dst + vers, s);
  console.log(vers, s.split('\n').length, 'lignes');
}
