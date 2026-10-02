// Écrit sorties/liste/couverture.md : chaque ID LST- de la carte, les tests ÉCRITS qui le portent et
// leur dernier état CONNU. Aucun accès à l'app ni à la base : lecture des fichiers seulement.
//   node D:/lume-uiaudit/outils/liste/couverture.mjs
//
// Sources :
//  · la carte            D:/lume-uiaudit/sorties/map-liste.md (section 2.1) ;
//  · les tests écrits    D:/lume-uiaudit/wt/e2e/automations/liste/*.spec.ts (titres lus dans le code) ;
//  · les rapports JSON   sorties/liste/resultats-*.json (le plus récent de chaque test l'emporte) ;
//  · les états relevés à la main pendant les passages interrompus (table ETATS ci-dessous) ;
//  · les constats        sorties/liste/constats.jsonl (test → constat).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SORTIES = 'D:/lume-uiaudit/sorties';
const LOT = join(SORTIES, 'liste');
const SPECS = 'D:/lume-uiaudit/wt/e2e/automations/liste';
const JOUR = '2026-10-01';

// ── 1. Les ID de la carte ──
const ids = [];
for (const l of readFileSync(join(SORTIES, 'map-liste.md'), 'utf8').split('\n')) {
  const m = l.match(/^\| (LST-\d{3}) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|/);
  if (m) ids.push({ id: m[1], libelle: m[4].trim().replace(/\s+/g, ' ').slice(0, 70) });
}

// ── 2. Les tests écrits ──
const ecrits = [];
for (const f of readdirSync(SPECS).filter((x) => x.endsWith('.spec.ts')).sort()) {
  const src = readFileSync(join(SPECS, f), 'utf8');
  const re = /^\s*(?:test|base)\((['`])((?:\\.|(?!\1).)*)\1/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) ecrits.push({ fichier: f, titre: m[2].replace(/\\'/g, "'") });
}

// ── 3. Les états connus ──
// (a) relevés à la main : passages A (10 h 43), B (11 h 05, interrompu), C (11 h 25, complet), D (11 h 55, interrompu).
const VERT = (quand) => ({ etat: `vert (exécuté le ${JOUR} vers ${quand})`, sorte: 'vert' });
const DEFAUT = (quand) => ({ etat: `rouge — défaut produit (dernier passage : ${JOUR} vers ${quand})`, sorte: 'defaut' });
const PANNE = (note) => ({ etat: `rouge — panne ou lenteur de staging, à relancer${note ? ` (${note})` : ''}`, sorte: 'panne' });
const ETATS = [
  ['01-barre-haut', '[LST-002] « Vue d’ensemble »', VERT('11 h 57')],
  ['01-barre-haut', '[LST-003] « Réglages globaux »', VERT('11 h 59')],
  ['01-barre-haut', 'S-05 :', DEFAUT('12 h 00')],
  ['01-barre-haut', '[LST-004][LST-093] « Tout arrêter » demande confirmation', VERT('12 h 05')],
  ['01-barre-haut', 'arrêter puis reprendre', PANNE('toutes ses attentes ont passé au passage de 10 h 47 ; seul le moniteur a relevé le vol du verrou d’auth et un 403 au rechargement')],
  ['01-barre-haut', 'des clics répétés sur « Tout arrêter »', VERT('12 h 10')],
  ['01-barre-haut', 'un double clic sur « Tout arrêter » laisse', DEFAUT('12 h 12')],
  ['01-barre-haut', 'S-27 :', DEFAUT('12 h 15')],
  ['01-barre-haut', 'EN puis FR', VERT('12 h 18')],
  ['01-barre-haut', 'cliquer la langue déjà active', VERT('11 h 37')],
  ['01-barre-haut', 'pendant l’enregistrement, les deux boutons', PANNE('toutes ses attentes ont passé à 11 h 38 ; le moniteur a relevé des 500 de staging sur /folders et /pause')],
  ['01-barre-haut', 'S-31 :', DEFAUT('11 h 39')],
  ['01-barre-haut', 'S-51 : les boutons FR / EN', DEFAUT('11 h 40')],
  ['01-barre-haut', 'le refus du serveur est expliqué', PANNE('toutes ses attentes ont passé à 10 h 51 ; deux journaux de console attendus n’étaient pas encore déclarés, c’est corrigé')],
  ['01-barre-haut', '[LST-014] « Construire avec Lumi » ouvre', VERT('11 h 42')],
  ['01-barre-haut', '[LST-015] « Créer » ouvre un menu', VERT('11 h 42')],
  ['01-barre-haut', '[LST-016]', VERT('11 h 43')],
  ['01-barre-haut', '[LST-017]', VERT('11 h 43')],
  ['01-barre-haut', '[LST-018]', VERT('11 h 44')],
  ['01-barre-haut', '[LST-019]', VERT('11 h 45')],
  ['01-barre-haut', 'S-09 :', DEFAUT('11 h 46')],
  ['01-barre-haut', '[LST-001]', { etat: 'rouge — sélecteur ambigu DU TEST (corrigé depuis), à relancer ; l’écran « Fonctionnalité premium » et la fenêtre de forfait étaient bien là (11 h 49)', sorte: 'panne' }],
  ['01-barre-haut', '[LST-014] attendre', VERT('11 h 50')],
  ['13-libelles-et-complements', 'S-35 :', { etat: `rouge — défaut produit (observé le ${JOUR} à 10 h 55, avant le déplacement du test dans ce fichier ; non réexécuté depuis)`, sorte: 'defaut' }],
];
// (b) les rapports JSON des RELANCES (tout.sh en dépose un par fichier) : tout résultat postérieur à la
//     panne du 2026-10-01 (16 h 30 UTC) remplace l'état relevé à la main.
const APRES_LA_PANNE = new Date('2026-10-01T16:30:00Z');
const relances = new Map();
for (const f of readdirSync(LOT).filter((x) => /^resultats-.*\.json$/.test(x))) {
  const j = JSON.parse(readFileSync(join(LOT, f), 'utf8'));
  const marcher = (s) => {
    for (const sp of s.specs ?? []) {
      for (const t of sp.tests) {
        const r = t.results[t.results.length - 1];
        if (!r || new Date(r.startTime) <= APRES_LA_PANNE) continue;
        const connu = relances.get(sp.title);
        if (!connu || new Date(r.startTime) > new Date(connu.quand)) {
          relances.set(sp.title, { statut: r.status, quand: r.startTime, erreur: (r.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 160) });
        }
      }
    }
    for (const c of s.suites ?? []) marcher(c);
  };
  for (const s of j.suites ?? []) marcher(s);
}
const etatDe = (t) => {
  // Les titres en boucle (`${parametre}`) sont comparés par leur partie fixe.
  const fixe = t.titre.split('${')[0];
  const r = [...relances.entries()].filter(([titre]) => titre === t.titre || (t.titre.includes('${') && titre.startsWith(fixe)));
  if (r.length) {
    const quand = new Date(r[0][1].quand).toLocaleString('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' });
    const rouges = r.filter(([, x]) => x.statut !== 'passed');
    if (!rouges.length) return { etat: `vert (exécuté le ${quand})`, sorte: 'vert' };
    if (/ @defaut$/.test(t.titre)) return { etat: `rouge — défaut produit (dernier passage : ${quand})`, sorte: 'defaut' };
    return { etat: `rouge hors @defaut, à trier (${quand}) : ${rouges[0][1].erreur}`, sorte: 'panne' };
  }
  const e = ETATS.find(([f, bout]) => t.fichier.startsWith(f) && t.titre.includes(bout));
  return e ? e[2] : { etat: 'écrit, jamais exécuté', sorte: 'jamais' };
};

// ── 4. Les constats ──
const constats = existsSync(join(LOT, 'constats.jsonl'))
  ? readFileSync(join(LOT, 'constats.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const constatsDe = (t) => constats.filter((c) => String(c.test ?? '').includes(t.titre)).map((c) => c.id);

// ── 5. Le tableau par ID ──
const lignes = [];
let couverts = 0;
for (const { id, libelle } of ids) {
  const miens = ecrits.filter((t) => t.titre.includes(`[${id}]`));
  if (!miens.length) { lignes.push(`| ${id} | — (${libelle}) | NON TESTÉ |`); continue; }
  couverts += 1;
  const cellule = miens.map((t) => `${t.fichier} › ${t.titre.replace(/\|/g, '/')}`).join('<br>');
  const etats = miens.map((t) => {
    const e = etatDe(t);
    const c = constatsDe(t);
    return c.length ? `${e.etat} → ${c.join(', ')}` : e.etat;
  }).join('<br>');
  lignes.push(`| ${id} | ${cellule} | ${etats} |`);
}

const compte = { vert: 0, defaut: 0, panne: 0, jamais: 0 };
for (const t of ecrits) compte[etatDe(t).sorte] += 1;
const aDefaut = ecrits.filter((t) => / @defaut$/.test(t.titre));
const entete = existsSync(join(LOT, 'couverture-entete.md')) ? readFileSync(join(LOT, 'couverture-entete.md'), 'utf8') : '';
const pied = existsSync(join(LOT, 'couverture-pied.md')) ? readFileSync(join(LOT, 'couverture-pied.md'), 'utf8') : '';

const md = `# Couverture — lot « liste » (\`/automations\`)

${entete}
## Chiffres

- ID de la carte (section 2.1 de \`map-liste.md\`) : **${ids.length}** — portés par au moins un test ÉCRIT : **${couverts}**.
- Tests écrits : **${ecrits.length}** titres dans ${new Set(ecrits.map((t) => t.fichier)).size} fichiers (deux titres sont dans une boucle : \`?onglet=\` × 4 et les anciennes adresses × 2, soit ${ecrits.length + 4} tests à l'exécution), dont **${aDefaut.length}** marqués \`@defaut\` (ils affirment le comportement attendu et doivent rester rouges tant que le produit n'est pas corrigé).
- Dernier état connu : **${compte.vert}** verts, **${compte.defaut}** rouges pour un défaut du produit, **${compte.panne}** rouges à cause de staging (ou d'un sélecteur corrigé depuis) à relancer, **${compte.jamais}** écrits mais jamais exécutés.

## Par ID

| ID | Test écrit (fichier › titre) | Dernier état connu |
|---|---|---|
${lignes.join('\n')}

## Tous les tests, par fichier

| Fichier | Test | Dernier état connu |
|---|---|---|
${ecrits.map((t) => { const c = constatsDe(t); return `| ${t.fichier} | ${t.titre.replace(/\|/g, '/')} | ${etatDe(t).etat}${c.length ? ` → ${c.join(', ')}` : ''} |`; }).join('\n')}
${pied}`;
writeFileSync(join(LOT, 'couverture.md'), md);
console.log(`ID ${couverts}/${ids.length} ; tests écrits ${ecrits.length} (@defaut ${aDefaut.length}) ; états`, JSON.stringify(compte));
const sansTest = ids.filter(({ id }) => !ecrits.some((t) => t.titre.includes(`[${id}]`))).map((x) => x.id);
if (sansTest.length) console.log('sans test :', sansTest.join(' '));
const sansEtat = ETATS.filter(([f, bout]) => !ecrits.some((t) => t.fichier.startsWith(f) && t.titre.includes(bout)));
if (sansEtat.length) console.log('états sans test correspondant :', sansEtat.map((e) => e[1]).join(' | '));
