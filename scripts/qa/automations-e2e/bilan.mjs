#!/usr/bin/env node
/**
 * Bilan d'une passe des E2E de la section Automatisations, à partir du rapport JSON de Playwright.
 *
 *   node scripts/qa/automations-e2e/bilan.mjs <resultats.json> [--zero-defaut] [--sortie <dossier>]
 *
 * Le rapport est écrit par `lancer.mjs` dans `<E2E_SORTIES>/resultats.json`.
 *
 * Un test marqué `@defaut` affirme le comportement ATTENDU d'un défaut connu du produit : il est rouge tant
 * que le défaut existe. Le code de sortie de Playwright ne suffit donc pas à juger une passe. La règle :
 *
 *   ROUGE (code 1) si · un test SANS marque est rouge (régression, ou spec à remettre d'aplomb) ;
 *                     · un test `@defaut` est VERT (le défaut est corrigé : la marque doit être retirée) ;
 *                     · aucun test n'a été joué.
 *   Les rouges `@defaut` sont comptés et listés à part ; ils ne bloquent pas…
 *   … sauf avec `--zero-defaut` (le mode « prêt pour le launch ») : alors tout rouge `@defaut` bloque, et tout
 *   test NON JOUÉ aussi (sauté faute d'une condition : il n'est jamais compté vert).
 *
 * Écrit `bilan.json` et `BILAN.md` à côté du rapport (ou dans --sortie). Code 2 : rapport illisible.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const zeroDefaut = args.includes('--zero-defaut');
const iSortie = args.indexOf('--sortie');
const chemin = args.find((a, i) => !a.startsWith('--') && (iSortie < 0 || i !== iSortie + 1));
if (!chemin) {
  console.error('usage : node scripts/qa/automations-e2e/bilan.mjs <resultats.json> [--zero-defaut] [--sortie <dossier>]');
  process.exit(2);
}
let rapport;
try {
  rapport = JSON.parse(readFileSync(resolve(chemin), 'utf8'));
} catch (e) {
  console.error(`rapport illisible (${chemin}) : ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

/** Aplatit les suites imbriquées du rapport JSON de Playwright. */
function aplatir(suite, fil = []) {
  const out = [];
  for (const s of suite.suites ?? []) out.push(...aplatir(s, s.title && !/\.spec\.ts$/.test(s.title) ? [...fil, s.title] : fil));
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const dernier = t.results?.[t.results.length - 1];
      const erreur = String(dernier?.error?.message ?? dernier?.errors?.[0]?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '');
      const titre = [...fil, spec.title].join(' › ');
      out.push({
        fichier: String(spec.file ?? '').replace(/\\/g, '/'), ligne: spec.line, titre, projet: t.projectName,
        defaut: /@defaut/.test(spec.title),
        statut: t.status === 'expected' ? 'vert' : t.status === 'skipped' ? 'non_joue' : 'rouge',
        // Le banc range à part les pannes du poste et de la base : à relancer, pas à corriger.
        environnement: (t.annotations ?? []).some((a) => a.type === 'panne-environnement') || /PANNE D’ENVIRONNEMENT/.test(erreur),
        erreur: erreur.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' — ').slice(0, 300),
      });
    }
  }
  return out;
}
const tests = (rapport.suites ?? []).flatMap((s) => aplatir(s));

const verts = tests.filter((t) => t.statut === 'vert' && !t.defaut);
const defautVerts = tests.filter((t) => t.statut === 'vert' && t.defaut);
const rougesDefaut = tests.filter((t) => t.statut === 'rouge' && t.defaut);
const rougesSansMarque = tests.filter((t) => t.statut === 'rouge' && !t.defaut);
const nonJoues = tests.filter((t) => t.statut === 'non_joue');

const raisons = [];
if (tests.length === 0) raisons.push('aucun test joué');
if (rougesSansMarque.length) raisons.push(`${rougesSansMarque.length} test(s) sans marque rouge(s)`);
if (defautVerts.length) raisons.push(`${defautVerts.length} test(s) @defaut vert(s) : marque à retirer`);
if (zeroDefaut && rougesDefaut.length) raisons.push(`${rougesDefaut.length} défaut(s) connu(s) encore ouvert(s) (--zero-defaut)`);
if (zeroDefaut && nonJoues.length) raisons.push(`${nonJoues.length} test(s) non joué(s) (--zero-defaut)`);
const verdict = raisons.length ? 'ROUGE' : 'VERT';

const court = (t) => ({ fichier: t.fichier, ligne: t.ligne, projet: t.projet, titre: t.titre, ...(t.erreur ? { erreur: t.erreur } : {}), ...(t.environnement ? { environnement: true } : {}) });
const parDossier = {};
for (const t of tests) {
  const d = t.fichier.includes('/') ? t.fichier.split('/')[0] : 'banc';
  const c = (parDossier[d] ??= { tests: 0, verts: 0, rouges_defaut: 0, rouges_sans_marque: 0, defaut_verts: 0, non_joues: 0 });
  c.tests += 1;
  if (t.statut === 'non_joue') c.non_joues += 1;
  else if (t.statut === 'vert') { if (t.defaut) c.defaut_verts += 1; else c.verts += 1; }
  else if (t.defaut) c.rouges_defaut += 1;
  else c.rouges_sans_marque += 1;
}
const bilan = {
  verdict, raisons, mode: zeroDefaut ? 'zero-defaut' : 'ordinaire', rapport: resolve(chemin),
  total: tests.length, verts: verts.length, rouges_defaut: rougesDefaut.length, rouges_sans_marque: rougesSansMarque.length,
  defaut_verts: defautVerts.length, non_joues: nonJoues.length,
  dont_pannes_d_environnement: rougesSansMarque.filter((t) => t.environnement).length,
  par_dossier: parDossier,
  listes: {
    rouges_sans_marque: rougesSansMarque.map(court), defaut_verts: defautVerts.map(court),
    rouges_defaut: rougesDefaut.map(court), non_joues: nonJoues.map(court),
  },
};

const md = [
  `# E2E de la section Automatisations — bilan : ${verdict}`,
  '',
  raisons.length ? `Pourquoi : ${raisons.join(' ; ')}.` : 'Aucun test sans marque rouge, aucun `@defaut` vert.',
  '',
  `${tests.length} tests — ${verts.length} verts, ${rougesDefaut.length} rouges \`@defaut\` (défauts connus), ${rougesSansMarque.length} rouges sans marque, ${defautVerts.length} \`@defaut\` verts, ${nonJoues.length} non joués.`,
  '',
  '| Dossier | Tests | Verts | Rouges `@defaut` | Rouges sans marque | `@defaut` verts | Non joués |',
  '|---|---|---|---|---|---|---|',
  ...Object.entries(parDossier).sort(([a], [b]) => a.localeCompare(b)).map(([d, c]) => `| ${d} | ${c.tests} | ${c.verts} | ${c.rouges_defaut} | ${c.rouges_sans_marque} | ${c.defaut_verts} | ${c.non_joues} |`),
  '',
];
const section = (titre, liste, avecErreur) => {
  if (!liste.length) return;
  md.push(`## ${titre} (${liste.length})`, '');
  for (const t of liste) md.push(`- \`${t.fichier}:${t.ligne}\`${t.projet && t.projet !== 'bureau' ? ` [${t.projet}]` : ''} — ${t.titre}${avecErreur && t.erreur ? `\n  - ${t.environnement ? '(panne d’environnement, à relancer) ' : ''}${t.erreur}` : ''}`);
  md.push('');
};
section('Rouges sans marque — à traiter avant tout', rougesSansMarque, true);
section('`@defaut` verts — le défaut est corrigé, retirer la marque', defautVerts, false);
section('Non joués — jamais comptés verts', nonJoues, false);
section('Rouges `@defaut` — défauts connus encore ouverts', rougesDefaut, false);

const dossier = iSortie >= 0 && args[iSortie + 1] ? resolve(args[iSortie + 1]) : dirname(resolve(chemin));
mkdirSync(dossier, { recursive: true });
writeFileSync(join(dossier, 'bilan.json'), JSON.stringify(bilan, null, 2));
writeFileSync(join(dossier, 'BILAN.md'), md.join('\n'));

console.log(`${verdict} — ${tests.length} tests : ${verts.length} verts, ${rougesDefaut.length} rouges @defaut, ${rougesSansMarque.length} rouges sans marque, ${defautVerts.length} @defaut verts, ${nonJoues.length} non joués`);
for (const r of raisons) console.log(`  · ${r}`);
console.log(`  bilan : ${join(dossier, 'BILAN.md')}`);
process.exit(verdict === 'VERT' ? 0 : 1);
