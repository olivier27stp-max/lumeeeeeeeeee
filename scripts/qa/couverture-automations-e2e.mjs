#!/usr/bin/env node
/**
 * Couverture des E2E de la section Automatisations.
 *
 * Croise les identifiants de AUTOMATIONS_UI_MAP.md (LST-, MOD-, MSG-, APR-,
 * REG-, EDT-, EXT-) avec les titres des tests Playwright (« [LST-012] … »)
 * du fichier de résultats JSON, et dit pour chaque élément : couvert et vert,
 * couvert mais rouge, ou jamais testé.
 *
 *   node scripts/qa/couverture-automations-e2e.mjs <resultats.json> [sortie.md]
 *
 * Code de sortie : 0 si chaque élément a au moins un test et que tous ses
 * tests sont verts ; 1 sinon (le déploiement ne doit pas partir).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , cheminResultats, cheminSortie] = process.argv;
if (!cheminResultats) {
  console.error('usage : node scripts/qa/couverture-automations-e2e.mjs <resultats.json> [sortie.md]');
  process.exit(2);
}

const FAMILLES = 'LST|MOD|MSG|APR|REG|EDT|EXT';
const carte = readFileSync(resolve('AUTOMATIONS_UI_MAP.md'), 'utf8');
const idsCarte = [...new Set([...carte.matchAll(new RegExp(`^\\| *\\*{0,2}((?:${FAMILLES})-N?\\d+[a-z]?)`, 'gm'))].map((m) => m[1]))];

/** Aplatit les suites imbriquées du rapport JSON de Playwright. */
function tests(suite, chemin = []) {
  const out = [];
  for (const s of suite.suites ?? []) out.push(...tests(s, [...chemin, s.title]));
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const dernier = t.results?.[t.results.length - 1];
      out.push({
        titre: spec.title, fichier: spec.file, projet: t.projectName,
        statut: t.status === 'expected' ? 'vert' : t.status === 'skipped' ? 'sauté' : t.status === 'flaky' ? 'instable' : 'rouge',
        duree: dernier?.duration ?? 0,
      });
    }
  }
  return out;
}
const rapport = JSON.parse(readFileSync(resolve(cheminResultats), 'utf8'));
const tous = tests(rapport);

const parId = new Map(idsCarte.map((id) => [id, []]));
const horsCarte = new Map();
for (const t of tous) {
  for (const m of t.titre.matchAll(/\[((?:[A-Z]+)-N?\d+[a-z]?)\]/g)) {
    const id = m[1];
    if (parId.has(id)) parId.get(id).push(t);
    else if (new RegExp(`^(${FAMILLES})-`).test(id)) { if (!horsCarte.has(id)) horsCarte.set(id, []); horsCarte.get(id).push(t); }
  }
}

const etat = (ts) => (ts.length === 0 ? 'non testé' : ts.every((t) => t.statut === 'vert') ? 'vert' : ts.some((t) => t.statut === 'rouge' || t.statut === 'instable') ? 'rouge' : 'sauté');
const lignes = idsCarte.map((id) => ({ id, tests: parId.get(id), etat: etat(parId.get(id)) }));
const n = (e) => lignes.filter((l) => l.etat === e).length;
const total = idsCarte.length;
const testes = total - n('non testé');
const synthese = {
  elements: total, testes, verts: n('vert'), rouges: n('rouge'), sautes: n('sauté'), nonTestes: n('non testé'),
  tests: { total: tous.length, verts: tous.filter((t) => t.statut === 'vert').length, rouges: tous.filter((t) => t.statut === 'rouge').length, instables: tous.filter((t) => t.statut === 'instable').length, sautes: tous.filter((t) => t.statut === 'sauté').length },
  idsHorsCarte: [...horsCarte.keys()],
};

const md = [
  '# Couverture des E2E — section Automatisations',
  '',
  `- Éléments de la carte testés : **${testes} / ${total}**`,
  `- Éléments dont tous les tests sont verts : **${synthese.verts} / ${total}**`,
  `- Tests : ${synthese.tests.total} (${synthese.tests.verts} verts, ${synthese.tests.rouges} rouges, ${synthese.tests.instables} instables, ${synthese.tests.sautes} sautés)`,
  '',
  ...(synthese.nonTestes ? ['## Éléments jamais testés', '', ...lignes.filter((l) => l.etat === 'non testé').map((l) => `- ${l.id}`), ''] : []),
  ...(synthese.rouges ? ['## Éléments dont un test est rouge', '', '| ID | Test | Projet |', '|---|---|---|',
    ...lignes.filter((l) => l.etat === 'rouge').flatMap((l) => l.tests.filter((t) => t.statut !== 'vert').map((t) => `| ${l.id} | ${t.fichier} › ${t.titre.replace(/\|/g, '/')} | ${t.projet} |`)), ''] : []),
  ...(horsCarte.size ? ['## Identifiants cités par un test et absents de la carte', '', ...[...horsCarte.keys()].map((id) => `- ${id}`), ''] : []),
  '## Détail', '', '| ID | État | Tests |', '|---|---|---|',
  ...lignes.map((l) => `| ${l.id} | ${l.etat} | ${l.tests.length} |`),
  '',
].join('\n');

if (cheminSortie) {
  writeFileSync(resolve(cheminSortie), md);
  writeFileSync(resolve(cheminSortie.replace(/\.md$/, '.json')), JSON.stringify({ synthese, lignes: lignes.map((l) => ({ id: l.id, etat: l.etat, tests: l.tests.map((t) => `${t.fichier} › ${t.titre} [${t.projet}] ${t.statut}`) })) }, null, 2));
}
console.log(`Couverture : ${testes} / ${total} éléments testés, ${synthese.verts} / ${total} verts ; ${synthese.tests.total} tests (${synthese.tests.rouges} rouges, ${synthese.tests.instables} instables).`);
process.exit(synthese.nonTestes || synthese.rouges || synthese.tests.rouges || synthese.tests.instables ? 1 : 0);
