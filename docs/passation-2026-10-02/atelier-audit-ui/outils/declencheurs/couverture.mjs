// Construit le tableau de couverture du lot « declencheurs » à partir des rapports JSON de Playwright.
//   node couverture.mjs resultats-passe1.json [resultats-passe2.json …]   (le dernier résultat d'un test l'emporte)
// Sorties : tableau-ids.md (à inclure dans couverture.md) et resume.json.
import { readFileSync, writeFileSync } from 'node:fs';

const SORTIES = 'D:/lume-uiaudit/sorties/declencheurs';
const fichiers = process.argv.slice(2);
if (!fichiers.length) throw new Error('usage : node couverture.mjs <rapport.json>…');

/** titre complet → { fichier, titre, statut, erreurs } */
const tests = new Map();
function parcourir(suite, fichier) {
  for (const s of suite.suites ?? []) parcourir(s, s.file ?? fichier);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      if (t.projectName && t.projectName !== 'bureau') continue;
      const r = t.results?.[t.results.length - 1];
      if (!r) continue;
      const erreurs = (r.errors ?? []).map((e) => String(e.message ?? '').replace(/\u001b\[[0-9;]*m/g, ''));
      tests.set(`${spec.file ?? fichier} › ${spec.title}`, {
        fichier: (spec.file ?? fichier ?? '').replace(/^.*declencheurs[\\/]/, ''), titre: spec.title, statut: r.status, erreurs,
        duree: r.duration,
      });
    }
  }
}
for (const f of fichiers) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const s of j.suites ?? []) parcourir(s, s.file);
}

// Les constats : lien test → identifiant.
let constats = [];
try {
  constats = readFileSync(`${SORTIES}/constats.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch { /* pas encore écrit */ }
const constatsDuTest = (t) => constats.filter((c) => {
  const titres = Array.isArray(c.tests) ? c.tests : [c.test];
  return titres.some((x) => x && x.includes(t.titre.replace(/ @defaut$/, '').slice(0, 80)));
}).map((c) => c.id);

const LOT = [
  'EDT-018', 'EDT-022', 'EDT-029', 'EDT-030', 'EDT-032', 'EDT-056', 'EDT-057', 'EDT-058', 'EDT-060', 'EDT-061', 'EDT-062', 'EDT-063',
  'EDT-064', 'EDT-065', 'EDT-066', 'EDT-067', 'EDT-068', 'EDT-069', 'EDT-070', 'EDT-071', 'EDT-072', 'EDT-073', 'EDT-074',
  'EDT-076', 'EDT-077', 'EDT-081', 'EDT-082', 'EDT-083', 'EDT-084',
  'EDT-087', 'EDT-088', 'EDT-089', 'EDT-090', 'EDT-091', 'EDT-092', 'EDT-093', 'EDT-094', 'EDT-095', 'EDT-096', 'EDT-097', 'EDT-098', 'EDT-099',
  'EDT-107', 'EDT-118', 'EDT-119', 'EDT-120', 'EDT-121', 'EDT-122', 'EDT-123', 'EDT-124', 'EDT-125', 'EDT-127',
  'LST-070',
  ...Array.from({ length: 28 }, (_, i) => `DEC-${String(i + 1).padStart(2, '0')}`),
];

const resultatDe = (t) => {
  if (t.statut === 'passed') return 'OK';
  const ids = constatsDuTest(t);
  if (/@defaut/.test(t.titre)) return `DÉFAUT → ${ids.join(', ') || 'C-??'}`;
  return ids.length ? `DÉFAUT → ${ids.join(', ')}` : `ROUGE (${t.statut}) — hors défaut déclaré`;
};

const lignes = ['| ID | Test (fichier › titre) | Résultat |', '|---|---|---|'];
const sansTest = [];
for (const id of LOT) {
  const concernes = [...tests.values()].filter((t) => t.titre.includes(`[${id}]`));
  if (!concernes.length) { sansTest.push(id); lignes.push(`| ${id} | — | AUCUN TEST |`); continue; }
  for (const t of concernes) lignes.push(`| ${id} | ${t.fichier} › ${t.titre.replace(/\|/g, '/')} | ${resultatDe(t)} |`);
}
writeFileSync(`${SORTIES}/tableau-ids.md`, lignes.join('\n') + '\n');

const tous = [...tests.values()];
const resume = {
  tests: tous.length,
  verts: tous.filter((t) => t.statut === 'passed').length,
  rouges: tous.filter((t) => t.statut !== 'passed').length,
  rouges_defaut: tous.filter((t) => t.statut !== 'passed' && /@defaut/.test(t.titre)).length,
  rouges_hors_defaut: tous.filter((t) => t.statut !== 'passed' && !/@defaut/.test(t.titre)).map((t) => `${t.fichier} › ${t.titre}`),
  verts_marques_defaut: tous.filter((t) => t.statut === 'passed' && /@defaut/.test(t.titre)).map((t) => `${t.fichier} › ${t.titre}`),
  ids_du_lot: LOT.length,
  ids_sans_test: sansTest,
  ids_couverts: LOT.length - sansTest.length,
};
writeFileSync(`${SORTIES}/resume.json`, JSON.stringify(resume, null, 1));
console.log(JSON.stringify(resume, null, 1));
// Détail des rouges : première erreur de chacun.
for (const t of tous.filter((x) => x.statut !== 'passed')) {
  console.log(`\n✗ ${t.fichier} › ${t.titre}\n   ${(t.erreurs[0] ?? '').split('\n').slice(0, 6).join('\n   ')}`);
}
