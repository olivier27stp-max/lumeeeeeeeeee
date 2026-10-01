/**
 * Rapport de `npm run test:automations`, lisible par un humain (RAPPORT.md) et
 * par QA Smoke (synthese.json).
 *
 * La matrice vient des fragments tests/automations-suite/matrice/<LETTRE>.md
 * (assemblés dans AUTOMATIONS_TEST_MATRIX.md) : chaque ligne de tableau dont
 * la 1re colonne est un identifiant de cellule (`B-012`, `F-003`…) est une
 * cellule. Un test la couvre quand son intitulé contient `[B-012]`.
 *   PASS         tous les tests qui la citent ont réussi
 *   FAIL         au moins un a échoué
 *   NON COUVERT  aucun test ne la cite (ou tous ignorés) — la raison est dans
 *                la dernière colonne de la matrice
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const DOSSIER = 'rapports/automatisations';
// Un JSON par projet (resultats-unitaires.json, …), fusionnés ici.
const fichiersResultats = existsSync(DOSSIER)
  ? readdirSync(DOSSIER).filter((f) => /^resultats.*\.json$/.test(f)).sort()
  : [];
if (fichiersResultats.length === 0) {
  console.error(`Aucun ${DOSSIER}/resultats-*.json : la suite n'a pas tourné.`);
  process.exit(1);
}
const brut = { testResults: fichiersResultats.flatMap((f) => JSON.parse(readFileSync(`${DOSSIER}/${f}`, 'utf8')).testResults ?? []) };

const tests = [];
for (const fichier of brut.testResults ?? []) {
  const nomFichier = String(fichier.name).replace(/\\/g, '/').replace(/^.*?(tests\/)/, '$1');
  for (const a of fichier.assertionResults ?? []) {
    tests.push({
      fichier: nomFichier,
      titre: [...(a.ancestorTitles ?? []), a.title].join(' › '),
      statut: a.status, // passed | failed | skipped | pending | todo
      duree: Math.round(a.duration ?? 0),
      erreur: (a.failureMessages ?? []).join('\n').split('\n').slice(0, 6).join('\n'),
    });
  }
  if ((fichier.assertionResults ?? []).length === 0 && fichier.status === 'failed') {
    tests.push({ fichier: nomFichier, titre: '(fichier en échec au chargement)', statut: 'failed', duree: 0, erreur: String(fichier.message ?? '').slice(0, 600) });
  }
}

// ── Matrice ─────────────────────────────────────────────────────────────
const cellules = [];
// Les fragments par catégorie (tests/automations-suite/matrice/<LETTRE>.md) :
// AUTOMATIONS_TEST_MATRIX.md n'en est que l'assemblage pour la lecture.
const DOSSIER_MATRICE = 'tests/automations-suite/matrice';
const sourcesMatrice = existsSync(DOSSIER_MATRICE)
  ? readdirSync(DOSSIER_MATRICE).filter((f) => f.endsWith('.md')).sort().map((f) => `${DOSSIER_MATRICE}/${f}`)
  : [];
for (const source of sourcesMatrice) {
  for (const ligne of readFileSync(source, 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\|\s*([A-M]-\d{3})\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const colonnes = m[2].split('|').map((c) => c.trim());
    cellules.push({ id: m[1], description: colonnes.slice(0, -1).join(' · '), remarque: colonnes.at(-1) ?? '' });
  }
}
const statutCellule = (id) => {
  const lies = tests.filter((t) => t.titre.includes(`[${id}]`) || new RegExp(`\\[[^\\]]*\\b${id}\\b[^\\]]*\\]`).test(t.titre));
  const joues = lies.filter((t) => t.statut === 'passed' || t.statut === 'failed');
  if (joues.length === 0) return { statut: 'NON COUVERT', tests: lies.length };
  return { statut: joues.some((t) => t.statut === 'failed') ? 'FAIL' : 'PASS', tests: joues.length };
};
const matrice = cellules.map((c) => ({ ...c, ...statutCellule(c.id) }));

const compte = (s) => tests.filter((t) => t.statut === s).length;
const CIBLE = process.env.QA_AUTO_PROD === 'je-confirme-la-prod' ? 'production' : 'staging';
const synthese = {
  date: new Date().toISOString(),
  cible: CIBLE,
  succes: compte('failed') === 0 && tests.length > 0,
  tests: { total: tests.length, reussis: compte('passed'), echoues: compte('failed'), ignores: tests.length - compte('passed') - compte('failed') },
  matrice: {
    total: matrice.length,
    pass: matrice.filter((c) => c.statut === 'PASS').length,
    fail: matrice.filter((c) => c.statut === 'FAIL').length,
    non_couvert: matrice.filter((c) => c.statut === 'NON COUVERT').length,
    cellules: Object.fromEntries(matrice.map((c) => [c.id, c.statut])),
  },
  echecs: tests.filter((t) => t.statut === 'failed').map(({ fichier, titre, erreur }) => ({ fichier, titre, erreur })),
};
writeFileSync(`${DOSSIER}/synthese.json`, JSON.stringify(synthese, null, 2));

// ── Markdown ────────────────────────────────────────────────────────────
const md = [];
md.push(`# Suite des automatisations — ${synthese.succes ? '✅ VERT' : '❌ ROUGE'}`, '');
md.push(`Généré le ${synthese.date} — cible : **${CIBLE}**.`, '');
md.push(`**Tests** : ${synthese.tests.reussis} réussis, ${synthese.tests.echoues} échoués, ${synthese.tests.ignores} ignorés (${synthese.tests.total}).`, '');
if (matrice.length) md.push(`**Matrice** : ${synthese.matrice.pass} PASS · ${synthese.matrice.fail} FAIL · ${synthese.matrice.non_couvert} NON COUVERT (${matrice.length} cellules).`, '');
if (synthese.echecs.length) {
  md.push('## Échecs', '');
  for (const e of synthese.echecs) md.push(`### ${e.titre}`, `\`${e.fichier}\``, '```', e.erreur, '```', '');
}
if (matrice.length) {
  md.push('## Matrice', '', '| Cellule | Statut | Tests | Description | Remarque |', '|---|---|---|---|---|');
  for (const c of matrice) md.push(`| ${c.id} | ${c.statut === 'PASS' ? '✅ PASS' : c.statut === 'FAIL' ? '❌ FAIL' : '⬜ NON COUVERT'} | ${c.tests} | ${c.description.replace(/\|/g, '/')} | ${c.remarque.replace(/\|/g, '/')} |`);
  md.push('');
}
md.push('## Par fichier', '', '| Fichier | Réussis | Échoués | Ignorés |', '|---|---|---|---|');
const parFichier = new Map();
for (const t of tests) {
  const f = parFichier.get(t.fichier) ?? { r: 0, e: 0, i: 0 };
  if (t.statut === 'passed') f.r++; else if (t.statut === 'failed') f.e++; else f.i++;
  parFichier.set(t.fichier, f);
}
for (const [f, c] of [...parFichier].sort()) md.push(`| ${f} | ${c.r} | ${c.e} | ${c.i} |`);
writeFileSync(`${DOSSIER}/RAPPORT.md`, md.join('\n') + '\n');
console.log(`Rapport : ${DOSSIER}/RAPPORT.md — ${synthese.succes ? 'VERT' : 'ROUGE'} (${synthese.tests.echoues} échec(s))`);
