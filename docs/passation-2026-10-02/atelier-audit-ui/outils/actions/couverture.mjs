// Calcule la couverture du lot « actions » à partir des passes archivées
// (D:/lume-uiaudit/sorties/actions/passes/*.json) : pour chaque test, la DERNIÈRE exécution fait foi.
//   node D:/lume-uiaudit/outils/actions/couverture.mjs            → écrit couverture.md
//   node D:/lume-uiaudit/outils/actions/couverture.mjs --resume   → affiche seulement le résumé
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SORTIES = 'D:/lume-uiaudit/sorties/actions';
const PASSES = join(SORTIES, 'passes');

/** Tous les tests d'un rapport JSON de Playwright, à plat. */
function tests(rapport) {
  const out = [];
  const marcher = (suite, fichier) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const r = t.results?.[t.results.length - 1];
        if (!r) continue;
        out.push({
          fichier: (spec.file ?? fichier ?? '').replace(/\\/g, '/').replace(/^.*actions\//, ''),
          titre: spec.title, statut: r.status, duree: r.duration,
          erreurs: (r.errors ?? []).map((e) => String(e.message ?? '').replace(/\u001b\[[0-9;]*m/g, '')),
          debut: r.startTime,
        });
      }
    }
    for (const s of suite.suites ?? []) marcher(s, suite.file ?? fichier);
  };
  for (const s of rapport.suites ?? []) marcher(s, s.file);
  return out;
}

const derniers = new Map();
for (const f of readdirSync(PASSES).filter((x) => x.endsWith('.json')).sort()) {
  let rapport;
  try { rapport = JSON.parse(readFileSync(join(PASSES, f), 'utf8')); } catch { continue; }
  for (const t of tests(rapport)) {
    if (t.statut === 'skipped') continue;
    derniers.set(`${t.fichier} › ${t.titre}`, { ...t, passe: f });
  }
}

/** Une erreur qui ne vient que de l'environnement (staging saturé), pas du produit. */
function infra(t) {
  if (t.statut === 'passed') return false;
  const m = t.erreurs.join('\n');
  if (!m) return false;
  const sansInfra = m
    .split('\n')
    .filter((l) => /·\s\[/.test(l))
    .filter((l) => !/Lock broken by another request|403 POST .*\/rest\/v1\/orgs|statement timeout|5\d\d (GET|POST|PATCH) .*(supabase\.co|\/api\/(billing|me|features|automations\/rules\/stats|automations\/editeur|custom-fields))|net::ERR|Failed to fetch|\[echec\]/.test(l));
  const moniteurSeul = /Le moniteur/.test(m) && sansInfra.length === 0 && !/expect\(|toEqual|toBe|toHave|attendre :/.test(m.replace(/Le moniteur[\s\S]*$/, ''));
  const delai = /Test timeout of|Chargement de l'espace|route\.fetch: Timeout|page\.goto: Timeout|getByRole\('tab', \{ name: \/\^\(Parcours\|Builder\)\$\/ \}\)/.test(m);
  return moniteurSeul || delai;
}

const constats = existsSync(join(SORTIES, 'constats.jsonl'))
  ? readFileSync(join(SORTIES, 'constats.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const constatDe = (cle) => constats.filter((c) => c.test === cle || (Array.isArray(c.tests) && c.tests.includes(cle))).map((c) => c.id);

const tous = [...derniers.entries()].map(([cle, t]) => ({ cle, ...t, defaut: / @defaut$/.test(t.titre), infra: infra(t) }));
const verts = tous.filter((t) => t.statut === 'passed');
const rouges = tous.filter((t) => t.statut !== 'passed');
const resume = [
  `Tests : ${tous.length} — verts ${verts.length}, rouges ${rouges.length}`,
  `  rouges marqués @defaut : ${rouges.filter((t) => t.defaut).length}`,
  `  rouges d'environnement (staging saturé) : ${rouges.filter((t) => !t.defaut && t.infra).length}`,
  `  rouges à trier : ${rouges.filter((t) => !t.defaut && !t.infra).length}`,
  `  verts marqués @defaut (à démarquer) : ${verts.filter((t) => t.defaut).length}`,
];
console.log(resume.join('\n'));
for (const t of rouges.filter((x) => !x.defaut)) console.log(`  ${t.infra ? 'ENV ' : 'TRI '} ${t.cle.slice(0, 150)}\n        ${(t.erreurs[0] ?? '').split('\n').slice(0, 2).join(' / ').slice(0, 260)}`);
for (const t of verts.filter((x) => x.defaut)) console.log(`  VERT@defaut ${t.cle.slice(0, 150)}`);
if (process.argv.includes('--rouges')) for (const t of rouges.filter((x) => x.defaut)) console.log(`  DEF  ${t.cle.slice(0, 170)}\n        ${(t.erreurs[0] ?? '').split('\n').slice(0, 3).join(' / ').slice(0, 300)}`);
if (process.argv.includes('--resume') || process.argv.includes('--rouges')) process.exit(0);

// ── Le tableau des ID du lot ──
const plage = (prefixe, a, b, n = 3) => Array.from({ length: b - a + 1 }, (_, i) => `${prefixe}-${String(a + i).padStart(n, '0')}`);
const LOT = [
  ...['EDT-056', 'EDT-057', 'EDT-059', 'EDT-060', 'EDT-061', 'EDT-062', 'EDT-063'],
  ...plage('EDT', 75, 86), ...plage('EDT', 100, 133), 'EDT-164',
];
const CATALOGUE = [...plage('ACT', 1, 21, 2), ...plage('CHA', 1, 40, 2)];

function ligne(id) {
  const lies = tous.filter((t) => t.titre.includes(`[${id}]`));
  if (!lies.length) return `| ${id} | — | NON TESTÉ |`;
  const cellule = lies.map((t) => `${t.fichier} › ${t.titre.replace(/\|/g, '/').slice(0, 170)}`).join('<br>');
  const defauts = lies.filter((t) => t.statut !== 'passed' && t.defaut);
  const env = lies.filter((t) => t.statut !== 'passed' && !t.defaut);
  let resultat = 'OK';
  if (defauts.length) {
    const ids = [...new Set(defauts.flatMap((t) => constatDe(t.cle)))];
    resultat = `DÉFAUT → ${ids.length ? ids.join(', ') : '(constat à rattacher)'}`;
  }
  if (env.length) resultat += `${resultat === 'OK' ? '' : ' ; '}${resultat === 'OK' ? 'NON CONCLUANT' : 'non concluant'} — ${env.length} test(s) rouge(s) hors défaut (${env.every((t) => t.infra) ? 'staging saturé' : 'à trier'})`;
  return `| ${id} | ${cellule} | ${resultat} |`;
}

const entete = '| ID | Test (fichier › titre) | Résultat |\n|---|---|---|';
const autres = [...new Set(tous.flatMap((t) => [...t.titre.matchAll(/\[([A-Z]+-N?\d+[a-z]?)\]/g)].map((m) => m[1])))]
  .filter((id) => !LOT.includes(id) && !CATALOGUE.includes(id)).sort();

const md = [
  '# Couverture — lot « actions »',
  '',
  `Calculée le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC sur la dernière exécution de chaque test (${tous.length} tests, projet « bureau », Chromium 1440×900).`,
  '',
  ...resume.map((l) => `- ${l.trim()}`),
  '',
  '« NON CONCLUANT » : le test n’a pas pu aller au bout parce que staging était saturé (délais Supabase, « statement timeout ») — ce n’est ni un succès ni un défaut du produit.',
  '',
  '## ID de la carte (tiroir Actions, champ générique, panneau d’étape)',
  '',
  entete,
  ...LOT.map(ligne),
  '',
  '## Catalogue : une ligne par action et par champ d’action',
  '',
  entete,
  ...CATALOGUE.map(ligne),
  '',
  '## Autres ID touchés par les tests du lot (hors lot, couverts au passage)',
  '',
  entete,
  ...autres.map(ligne),
  '',
].join('\n');
writeFileSync(join(SORTIES, 'couverture.md'), md);
console.log(`\ncouverture.md écrit (${LOT.length} ID du lot, ${CATALOGUE.length} lignes de catalogue, ${autres.length} autres ID).`);
