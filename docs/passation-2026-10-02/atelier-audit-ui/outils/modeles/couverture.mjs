// Écrit sorties/modeles/couverture.md : TOUS les ID du lot (MOD, MSG, APR, REG de map-liste.md), les tests
// écrits pour chacun, et leur dernier état CONNU. Hors ligne : ne lance aucun test, n'appelle ni l'app ni la base.
//
// Sources :
//  · sorties/map-liste.md              → les ID et leur libellé ;
//  · sorties/modeles/liste-tests.txt   → les tests écrits (`playwright test --list`) ;
//  · sorties/modeles/verdicts.json     → s'il existe, les verdicts fusionnés des passes (verdicts.mjs) ;
//  · ETATS ci-dessous                  → ce qui a été relevé à la main le 2026-10-01 (passes interrompues par la panne).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SORTIES = 'D:/lume-uiaudit/sorties';
const JOUR = '2026-10-01';

// ── Les ID du lot ──
const carte = readFileSync(`${SORTIES}/map-liste.md`, 'utf8');
const ids = [];
for (const l of carte.split(/\r?\n/)) {
  const m = l.match(/^\| ((?:MOD|MSG|APR|REG)-\d+) \|([^|]*)\|([^|]*)\|([^|]*)\|/);
  if (m) ids.push({ id: m[1], type: m[3].trim(), libelle: m[4].trim().replace(/\s+/g, ' ').slice(0, 70) });
}

// ── Les tests écrits ──
const tests = [];
for (const l of readFileSync(`${SORTIES}/modeles/liste-tests.txt`, 'utf8').split(/\r?\n/)) {
  const m = l.match(/› modeles.(\d\d-[a-z-]+\.spec\.ts):(\d+):\d+ › (.+)$/);
  if (!m) continue;
  const titre = m[3].split(' › ').at(-1);
  tests.push({ fichier: m[1], ligne: Number(m[2]), titre, ids: [...titre.matchAll(/\[([A-Z]+-[A-Z]?\d+)\]/g)].map((x) => x[1]), defaut: /@defaut/.test(titre) });
}

// ── États relevés le 2026-10-01 (01-bibliotheque : passes de 11 h 20 et de 12 h 05, interrompues par la panne de staging) ──
const VERT = `vert (exécuté le ${JOUR})`;
const PANNE = 'rouge — panne ou lenteur de staging, à relancer';
const JAMAIS = 'écrit, jamais exécuté';
/** [fichier, début du titre, état] — le premier qui correspond l'emporte. */
const ETATS = [
  ['00-jeu', '[BANC-M01]', VERT],
  ['01-bibliotheque', '[MOD-001] × ferme', VERT],
  ['01-bibliotheque', '[MOD-001] le catalogue affiché', VERT],
  ['01-bibliotheque', '[MOD-002] Échap ferme la bibliothèque depuis la grille', VERT],
  ['01-bibliotheque', '[MOD-002] Échap depuis l’aperçu', `${PANNE} (500 sur memberships au chargement)`],
  ['01-bibliotheque', '[MOD-003]', VERT],
  ['01-bibliotheque', '[MOD-004] Tab et Maj+Tab', VERT],
  ['01-bibliotheque', '[MOD-004][MOD-024][MOD-029] tout le parcours au clavier', VERT],
  ['01-bibliotheque', '[MOD-004] à l’aperçu d’un modèle, le focus', 'rouge — défaut produit → modeles-04'],
  ['01-bibliotheque', '[MOD-005] « Tous les modèles » décoche', VERT],
  ['01-bibliotheque', '[MOD-005] « Tous les modèles » n’a pas l’air actif', 'rouge — défaut produit → modeles-06 (observé à la passe de 11 h 20 ; la passe suivante est tombée sur la panne)'],
  ['01-bibliotheque', '[MOD-006]', VERT],
  ['01-bibliotheque', '[MOD-007] la case', VERT], ['01-bibliotheque', '[MOD-008] la case', VERT], ['01-bibliotheque', '[MOD-009] la case', VERT],
  ['01-bibliotheque', '[MOD-010] la case', VERT], ['01-bibliotheque', '[MOD-011] la case', VERT], ['01-bibliotheque', '[MOD-012] la case', VERT],
  ['01-bibliotheque', '[MOD-013] la case', VERT],
  ['01-bibliotheque', '[MOD-007][MOD-010] deux cases', VERT],
  ['01-bibliotheque', '[MOD-014] « Afficher plus »', VERT],
  ['01-bibliotheque', '[MOD-014] une catégorie cochée puis repliée', 'rouge — défaut produit → modeles-05'],
  ['01-bibliotheque', '[MOD-015] la recherche trouve par nom', `vert (exécuté le ${JOUR}, passe de 11 h 20) ; la passe suivante est tombée sur la panne : à relancer`],
  ['01-bibliotheque', '[MOD-015] la recherche porte aussi', PANNE],
  ['01-bibliotheque', '[MOD-015] la recherche se combine', PANNE],
  ['01-bibliotheque', '[MOD-015] caractères spéciaux', `vert (exécuté le ${JOUR}, passe de 11 h 20) ; la passe suivante est tombée sur la panne : à relancer`],
  ['01-bibliotheque', '[MOD-027]', PANNE],
  ['01-bibliotheque', '[MOD-016][MOD-017]', PANNE],
  ['01-bibliotheque', '[MOD-018]', PANNE],
  ['01-bibliotheque', '[MOD-019]', PANNE],
  ['01-bibliotheque', '[MOD-020][MOD-021]', PANNE],
];
/** Tests jamais exécutés dont le défaut a pourtant été OBSERVÉ à la main (exploration au navigateur, charge utile de l'API). */
const OBSERVES = [
  ['[MOD-024] aucun aperçu ne montre de clé technique brute', 'modeles-01'],
  ['[MSG-033][MSG-020] la palette « Insérer »', 'modeles-02'],
  ['[MSG-017] l’aperçu « réel » d’un rappel de rendez-vous', 'modeles-03'],
  ['[MOD-024] le nombre d’étapes annoncé sur la carte', 'modeles-07'],
  ['[MOD-024] l’aperçu montre TOUS les messages', 'modeles-08'],
  ['[MSG-001] vocabulaire', 'modeles-09'],
  ['[MOD-024] (anglais) aucun aperçu ne montre de texte français', 'modeles-10'],
  ['[MSG-017] l’aperçu « réel » remplace les mêmes variables', 'modeles-11'],
  ['[MOD-001] l’onglet de la liste et la bibliothèque ne portent pas le même nom', 'modeles-13'],
];

const verdicts = existsSync(`${SORTIES}/modeles/verdicts.json`) && process.argv.includes('--verdicts')
  ? new Map(JSON.parse(readFileSync(`${SORTIES}/modeles/verdicts.json`, 'utf8')).map((v) => [`${v.fichier} › ${v.titre}`, v]))
  : null;

function etatDe(t) {
  if (verdicts) {
    const v = verdicts.get(`${t.fichier} › ${t.titre}`);
    if (v && !v.interrompue) return v.ok ? VERT : (t.defaut ? 'rouge — défaut produit (voir constats.jsonl)' : 'rouge — à regarder');
  }
  const e = ETATS.find(([f, debut]) => t.fichier.startsWith(f) && t.titre.startsWith(debut));
  if (e) return e[2];
  const o = OBSERVES.find(([debut]) => t.titre.startsWith(debut));
  if (o) return `${JAMAIS} — défaut déjà OBSERVÉ à la main → ${o[1]}`;
  return t.defaut ? `${JAMAIS} — défaut PRÉSUMÉ d’après le code, à confirmer à l’exécution` : JAMAIS;
}

const lignes = [];
const sansTest = [];
for (const { id, type, libelle } of ids) {
  const ts = tests.filter((t) => t.ids.includes(id));
  if (!ts.length) { sansTest.push(id); lignes.push(`| ${id} | — (${type} : ${libelle}) | AUCUN TEST ÉCRIT |`); continue; }
  for (const t of ts) lignes.push(`| ${id} | ${t.fichier}:${t.ligne} › ${t.titre.replace(/\|/g, '/')} | ${etatDe(t)} |`);
}
const horsCarte = tests.filter((t) => t.ids.every((i) => !ids.some((x) => x.id === i)));
const compte = (pred) => tests.filter(pred).length;
const etats = tests.map((t) => etatDe(t));
const nb = (re) => etats.filter((e) => re.test(e)).length;

const md = `# Couverture — lot « modeles » (MOD, MSG, APR, REG)

État au ${JOUR}, 12 h 30 : **staging est tombé en panne pendant la première passe** (PostgREST en 503, « statement timeout », authentification lente). Seule une partie de \`01-bibliotheque.spec.ts\` a tourné ; tout le reste est écrit, vérifié par le compilateur (\`tsc --strict\`, 0 erreur) et par \`playwright test --list\` (${tests.length} tests reconnus), mais **jamais exécuté**.

## En bref

- ID du lot : **${ids.length}** (MOD ${ids.filter((x) => x.id.startsWith('MOD')).length}, MSG ${ids.filter((x) => x.id.startsWith('MSG')).length}, APR ${ids.filter((x) => x.id.startsWith('APR')).length}, REG ${ids.filter((x) => x.id.startsWith('REG')).length}) — couverts par au moins un test écrit : **${ids.length - sansTest.length}**${sansTest.length ? ` ; sans test : ${sansTest.join(', ')}` : ''}.
- Tests écrits : **${tests.length}** dans 7 fichiers (${['00', '01', '02', '03', '04', '05', '06'].map((p) => `${p} : ${compte((t) => t.fichier.startsWith(p))}`).join(' · ')}).
- Dernier état connu : **${nb(/^vert/)} verts**, **${nb(/^rouge — défaut produit/)} rouges pour un défaut du produit**, **${nb(/^rouge — panne/)} rouges pour cause de panne ou de lenteur de staging (à relancer)**, **${nb(/^écrit/)} écrits et jamais exécutés**.
- Parmi les ${compte((t) => t.defaut)} tests marqués \`@defaut\` : ${nb(/^rouge — défaut produit/)} ont été vus rouges pour la bonne raison ; ${nb(/OBSERVÉ à la main/)} portent sur un défaut observé à la main (exploration au navigateur, charge utile de l'API) sans que le test ait tourné ; **${nb(/PRÉSUMÉ/)} sont des présomptions tirées de la lecture du code** : si l'un d'eux sort VERT à la relance, il faut retirer \`@defaut\` de son titre (\`node verdicts.mjs\` les liste sous « @defaut MAIS VERT »).

## Lecture des états

| État | Sens |
|---|---|
| vert (exécuté le …) | le test a tourné contre l'app et a passé, moniteur compris |
| rouge — défaut produit → modeles-NN | le test a tourné, il est rouge pour la raison qu'il annonce ; le constat est dans \`constats.jsonl\` |
| rouge — panne ou lenteur de staging, à relancer | le test est tombé sur un 500 / 503, un délai, une session perdue : aucun verdict sur le produit |
| écrit, jamais exécuté | le test compile et est reconnu par Playwright ; il n'a jamais tourné |

## Tableau

| ID | Test (fichier:ligne › titre) | Dernier état connu |
|---|---|---|
${lignes.join('\n')}

## Tests hors carte (ID nouveaux ou outillage)

| Test | Dernier état connu |
|---|---|
${horsCarte.map((t) => `| ${t.fichier}:${t.ligne} › ${t.titre} | ${etatDe(t)} |`).join('\n') || '| — | — |'}

## Éléments absents de la carte, relevés à l'écran

Aucun nouvel élément interactif n'a été trouvé dans les écrans du lot pendant l'exploration (bibliothèque, aperçu d'un modèle, bloc texto, éditeur de courriel, vue d'ensemble, réglages globaux). Un écart de description : la carte donne un seul \`MSG-033\` pour « une quarantaine » de boutons de champs ; l'écran en montre plus de 120 (19 à 20 rangées) — voir le constat modeles-02.
`;
writeFileSync(`${SORTIES}/modeles/couverture.md`, md);
console.log(`${ids.length} ID, ${ids.length - sansTest.length} couverts ; ${tests.length} tests ; verts ${nb(/^vert/)} · défaut ${nb(/^rouge — défaut produit/)} · panne ${nb(/^rouge — panne/)} · jamais ${nb(/^écrit/)} (dont observés ${nb(/OBSERVÉ à la main/)}, présumés ${nb(/PRÉSUMÉ/)})`);
if (sansTest.length) console.log('SANS TEST :', sansTest.join(', '));
