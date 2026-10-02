// Fabrique couverture.md du lot « editeur » à partir des JSON de résultats (sorties/editeur/runs/*.json)
// et de constats.jsonl. Usage : node couverture.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SORTIES = 'D:/lume-uiaudit/sorties/editeur';
const RUNS = join(SORTIES, 'runs');
const plage = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `EDT-${String(a + i).padStart(3, '0')}`);
// Le lot : §2.1 à 2.5, 2.10 à 2.14 de la carte.
const LOT = [...plage(1, 3), ...plage(4, 12), ...plage(13, 19), ...plage(20, 55), ...plage(56, 63), ...plage(134, 139), ...plage(140, 147), ...plage(148, 149), ...plage(150, 153), ...plage(154, 166)];
const ZONES = [
  ['2.1 Écrans de chargement et d’erreur', 1, 3], ['2.2 Barre du haut', 4, 12], ['2.3 Onglets et barre d’actions', 13, 19],
  ['2.4 Canevas', 20, 55], ['2.5 Tiroir de choix', 56, 63], ['2.10 Clavardage Lumi', 134, 139], ['2.11 Onglet Réglages', 140, 147],
  ['2.12 Onglet Historique', 148, 149], ['2.13 Onglet Journaux', 150, 153], ['2.14 Dialogues et gardes de sortie', 154, 166],
];

const tests = [];
for (const f of readdirSync(RUNS).filter((x) => x.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(join(RUNS, f), 'utf8'));
  const walk = (s, fichier) => {
    for (const sp of s.specs || []) for (const t of sp.tests) {
      const res = t.results[t.results.length - 1];
      tests.push({ fichier: (fichier || s.file || '').replace(/^.*[\\/]/, ''), titre: sp.title, statut: res?.status ?? 'inconnu' });
    }
    for (const c of s.suites || []) walk(c, fichier || s.file);
  };
  r.suites.forEach((s) => walk(s, s.file));
}
const constats = existsSync(join(SORTIES, 'constats.jsonl'))
  ? readFileSync(join(SORTIES, 'constats.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const constatDe = (t) => constats.filter((c) => c.test === `${t.fichier} › ${t.titre}` || (c.autres_tests ?? []).includes(`${t.fichier} › ${t.titre}`)).map((c) => c.id);

const lignes = [];
let couverts = 0;
for (const id of LOT) {
  const siens = tests.filter((t) => t.titre.includes(`[${id}]`));
  if (!siens.length) { lignes.push(`| ${id} | — | NON TESTÉ |`); continue; }
  couverts += 1;
  siens.forEach((t, i) => {
    const c = constatDe(t);
    const res = t.statut === 'passed' ? 'OK' : c.length ? `DÉFAUT → ${c.join(', ')}` : `ROUGE (${t.statut}) — à examiner`;
    lignes.push(`| ${i === 0 ? id : ''} | ${t.fichier} › ${t.titre.replace(/\|/g, '/')} | ${res} |`);
  });
}
const verts = tests.filter((t) => t.statut === 'passed').length;
const horsLot = [...new Set(tests.flatMap((t) => [...t.titre.matchAll(/\[(EDT-N?\d+[a-z]?)\]/g)].map((m) => m[1])))].filter((x) => !LOT.includes(x));
const entete = [
  '# Couverture du lot « editeur » — structure de l’éditeur plein écran',
  '',
  `ID du lot couverts par au moins un test : **${couverts} / ${LOT.length}**. Tests : **${tests.length}** (${verts} verts, ${tests.length - verts} rouges).`,
  '',
  'Zones du lot (carte `map-editeur.md`) : ' + ZONES.map(([n, a, b]) => `${n} (EDT-${String(a).padStart(3, '0')} à ${String(b).padStart(3, '0')})`).join(' ; ') + '.',
  horsLot.length ? `\nID cités par des tests mais hors lot (ouverts / fermés seulement) : ${horsLot.join(', ')}.` : '',
  '',
  'Un test rouge marqué `@defaut` affirme le comportement ATTENDU : il passera au vert quand le produit sera corrigé. Le constat correspondant est dans `constats.jsonl`.',
  '',
  '| ID | Test (fichier › titre) | Résultat |',
  '|---|---|---|',
];
writeFileSync(join(SORTIES, 'couverture.md'), [...entete, ...lignes, ''].join('\n'));
console.log(`${couverts}/${LOT.length} ID couverts ; ${tests.length} tests, ${verts} verts, ${tests.length - verts} rouges`);
const sansConstat = tests.filter((t) => t.statut !== 'passed' && !constatDe(t).length);
if (sansConstat.length) { console.log('Rouges SANS constat :'); for (const t of sansConstat) console.log('  ', t.fichier, '›', t.titre); }
const constatsSansTest = constats.filter((c) => !tests.some((t) => `${t.fichier} › ${t.titre}` === c.test));
if (constatsSansTest.length) { console.log('Constats dont le test est introuvable :'); for (const c of constatsSansTest) console.log('  ', c.id, c.test); }
