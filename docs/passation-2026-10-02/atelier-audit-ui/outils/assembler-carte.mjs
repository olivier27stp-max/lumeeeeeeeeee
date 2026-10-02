// Assemble AUTOMATIONS_UI_MAP.md (racine du dépôt) à partir des trois cartes des agents,
// du relevé navigateur et des éléments nouveaux découverts pendant la tournée.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const S = 'D:/lume-uiaudit/sorties';
const lire = (f) => readFileSync(`${S}/${f}`, 'utf8');
const liste = lire('map-liste.md');
const editeur = lire('map-editeur.md');
const entrees = lire('map-entrees-api.md');
const ids = (t, p) => [...new Set([...t.matchAll(new RegExp(`^\\| *\\*{0,2}(${p}-[0-9N]+[a-z]?)`, 'gm'))].map((m) => m[1]))];
const familles = [
  ['LST', 'Liste `/automations`', liste], ['MOD', 'Bibliothèque de modèles', liste], ['MSG', 'Éditeurs de message', liste],
  ['APR', 'Vue d’ensemble `/automations/apercu`', liste], ['REG', 'Réglages globaux `/automations/reglages`', liste],
  ['EDT', 'Éditeur plein écran `/automations/:id`', editeur], ['EXT', 'Points d’entrée ailleurs dans l’app', entrees],
];
const comptes = familles.map(([p, nom, t]) => ({ p, nom, n: ids(t, p).length }));
const total = comptes.reduce((s, c) => s + c.n, 0);

// Éléments vus à l'écran pendant la tournée et absents des cartes tirées du code.
let nouveaux = '';
for (const d of existsSync(S) ? readdirSync(S) : []) {
  const f = `${S}/${d}/elements-nouveaux.md`;
  if (existsSync(f)) nouveaux += `\n### Lot « ${d} »\n\n${readFileSync(f, 'utf8').trim()}\n`;
}

let releve = '';
if (existsSync(`${S}/releve-navigateur.json`)) {
  const r = JSON.parse(lire('releve-navigateur.json'));
  releve = '| Écran / onglet | Éléments interactifs visibles |\n|---|---|\n'
    + r.releve.map((e) => `| ${e.ecran} | ${e.elements.length} |`).join('\n');
}

const decaler = (md) => md.replace(/^# .*$/m, '').replace(/^(#{1,5}) /gm, '#$1 ').trim();

const sortie = `# Carte de l'interface — section Automatisations

Checklist de couverture de l'audit utilisateur du ${new Date().toISOString().slice(0, 10)} : chaque élément interactif de la section, dans chaque état où il apparaît. Un élément listé ici doit avoir au moins un test Playwright dans \`e2e/automations/\` dont le titre porte son identifiant (\`[LST-012] …\`). La couverture se calcule par \`node scripts/qa/couverture-automations-e2e.mjs\`.

## Comment elle a été dressée

1. **Du code** : trois lectures complètes (liste et écrans associés ; éditeur plein écran et catalogue ; routes, points d'entrée, API, rôles, Lumi), avec un contrôle par \`grep\` de chaque gestionnaire (\`onClick\`, \`onChange\`, \`<button\`, \`<select\`…) contre les lignes d'inventaire.
2. **Du navigateur** : un relevé automatique des éléments interactifs visibles sur chaque écran, puis la tournée elle-même, qui ajoute les éléments vus à l'écran et absents du code lu (section « Éléments ajoutés pendant la tournée »).

## Décompte

| Famille | Écran | Éléments |
|---|---|---|
${comptes.map((c) => `| ${c.p}- | ${c.nom} | ${c.n} |`).join('\n')}
| | **Total** | **${total}** |

S'y ajoute le **catalogue** de ce qui se configure dans l'éditeur (partie 2, § 3) : 28 déclencheurs et leurs champs, 4 types d'étape (action, attendre, si, arrêter), 6 opérateurs de condition en texte et 20 opérateurs de condition de champ, 21 actions et leurs 40 champs — et les **43 routes serveur** de la partie 3, testées rôle par rôle.

## Relevé du navigateur (propriétaire, français, 1440 px)

${releve}

## Éléments ajoutés pendant la tournée
${nouveaux || '\n(aucun pour l’instant)\n'}

---

# Partie 1 — Liste, modèles, messages, vue d'ensemble, réglages globaux

${decaler(liste)}

---

# Partie 2 — Éditeur plein écran et catalogue

${decaler(editeur)}

---

# Partie 3 — Routes, points d'entrée, API, rôles, Lumi, envois

${decaler(entrees)}
`;
writeFileSync('D:/lume-uiaudit/wt/AUTOMATIONS_UI_MAP.md', sortie);
console.log(`AUTOMATIONS_UI_MAP.md : ${sortie.split('\n').length} lignes, ${total} éléments (${comptes.map((c) => `${c.p} ${c.n}`).join(', ')})`);
