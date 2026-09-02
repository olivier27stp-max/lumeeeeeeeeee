#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   La carte du territoire — inventaire des routes de l'application.

   POURQUOI
   Le robot de recette doit visiter TOUTES les pages, sous chaque
   rôle. Sans inventaire, il ne verrait que ce qu'un menu lui montre
   et raterait les pages atteignables uniquement par un bouton ou un
   lien direct. Cette carte est régénérée : une page ajoutée demain
   entre d'office dans le périmètre.

   CE QU'ELLE CONTIENT, PAR ROUTE
     - le chemin, et s'il s'agit d'une redirection (vers où)
     - la permission exigée   → sous quels rôles la page est visible
     - les barrières de forfait / module → écran de blocage attendu
     - le composant de page    → pour retrouver le fichier en cause

   Sortie : qa-carte.json

   Usage : npm run qa:carte
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();
const APP = path.join(RACINE, 'src', 'App.tsx');

if (!fs.existsSync(APP)) {
  console.error('src/App.tsx introuvable — lancer depuis la racine du projet.');
  process.exit(2);
}

const source = fs.readFileSync(APP, 'utf8');

/* ── 1. Les routes ──────────────────────────────────────────────
   On lit chaque <Route path="…" element={…}> en équilibrant les
   accolades : une regex simple casserait sur les éléments imbriqués
   (Gated > PlanFeatureGate > PageWrapper > Page).                */

function extraireRoutes(txt) {
  const routes = [];
  const re = /<Route\s+path="([^"]*)"/g;
  let m;
  while ((m = re.exec(txt))) {
    const chemin = m[1];
    const apres = txt.slice(m.index);
    const posElem = apres.indexOf('element={');
    // <Route path="…" /> sans element : rien à décrire.
    if (posElem === -1 || posElem > 400) { routes.push({ chemin, element: '' }); continue; }

    let i = posElem + 'element={'.length;
    let profondeur = 1;
    while (i < apres.length && profondeur > 0) {
      if (apres[i] === '{') profondeur++;
      else if (apres[i] === '}') profondeur--;
      i++;
    }
    routes.push({ chemin, element: apres.slice(posElem + 'element={'.length, i - 1) });
  }
  return routes;
}

/* ── 2. Lecture d'un élément de route ──────────────────────────── */

function decrire(chemin, element) {
  const r = { chemin };

  // Redirection : la page n'existe pas, elle renvoie ailleurs.
  const nav = element.match(/<Navigate\s+to="([^"]+)"/);
  if (nav) {
    r.redirigeVers = nav[1];
    return r;
  }

  // Permission exigée — <Gated permission="clients.read">
  const perm = element.match(/<Gated\s+permission="([^"]+)"/);
  if (perm) r.permission = perm[1];

  // Barrière de forfait — <PlanFeatureGate flag="includes_sms">
  const plan = element.match(/<PlanFeatureGate\s+flag="([^"]+)"/);
  if (plan) r.forfait = plan[1];

  // Barrière de module — <ModuleGate moduleKey="module_vente" …>
  const mod = element.match(/<ModuleGate\s+moduleKey="([^"]+)"/);
  if (mod) r.module = mod[1];

  // Composant de page : le dernier <Truc /> ou <Truc> rencontré,
  // en écartant les enveloppes connues qui ne sont pas des pages.
  const ENVELOPPES = new Set([
    'Gated', 'PageWrapper', 'PlanFeatureGate', 'ModuleGate', 'React.Suspense',
    'Suspense', 'div', 'Navigate', 'Route', 'ErrorBoundary',
  ]);
  const composants = [...element.matchAll(/<([A-Z][A-Za-z0-9_.]*)/g)]
    .map((x) => x[1])
    .filter((c) => !ENVELOPPES.has(c));
  if (composants.length) r.page = composants[composants.length - 1];

  return r;
}

/* ── 3. Où vit chaque composant ─────────────────────────────────
   On relie le nom du composant à son fichier via les imports, pour
   que le rapport puisse citer le fichier en cause.                */

function indexerImports(txt) {
  const index = {};
  // import X from '…'  /  import { A, B } from '…'  /  const X = lazy(() => import('…'))
  for (const m of txt.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) index[m[1]] = m[2];
  for (const m of txt.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    for (const nom of m[1].split(',')) {
      const propre = nom.trim().split(/\s+as\s+/).pop().trim();
      if (propre) index[propre] = m[2];
    }
  }
  for (const m of txt.matchAll(/const\s+(\w+)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) {
    index[m[1]] = m[2];
  }
  return index;
}

/* ── 4. Les entrées de menu ─────────────────────────────────────
   Repérées pour savoir ce qu'un utilisateur voit sans connaître
   l'URL — une page hors menu est un candidat au bouton mort.      */

function extraireMenu(txt) {
  const entrees = [];
  for (const m of txt.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?path:\s*'([^']+)'/g)) {
    entrees.push({ id: m[1], chemin: m[2] });
  }
  return entrees;
}

/* ── 5. Les sous-pages des réglages ─────────────────────────────
   Déclarées en routes relatives sous <Route path="/settings">.    */

function cheminComplet(chemin, routes, i) {
  if (chemin.startsWith('/') || chemin === '*') return chemin;
  // Route relative : on remonte à la route parente la plus proche
  // qui se termine par un chemin absolu.
  for (let j = i - 1; j >= 0; j--) {
    const p = routes[j].chemin;
    if (p.startsWith('/') && p !== '/' && !p.includes(':')) {
      return p.replace(/\/$/, '') + '/' + chemin;
    }
  }
  return chemin;
}

/* ── Assemblage ─────────────────────────────────────────────────── */

const brutes = extraireRoutes(source);
const imports = indexerImports(source);
const menu = extraireMenu(source);

const routes = brutes.map((r, i) => {
  const d = decrire(cheminComplet(r.chemin, brutes, i), r.element);
  if (d.page && imports[d.page]) d.fichier = imports[d.page].replace(/^\.\//, 'src/');
  d.dansLeMenu = menu.some((e) => e.chemin === d.chemin);
  return d;
});

// Une même page peut être déclarée deux fois (ex. /clients et /clients/:id/edit).
const vues = new Set();
const uniques = routes.filter((r) => {
  if (vues.has(r.chemin)) return false;
  vues.add(r.chemin);
  return true;
});

const visitables = uniques.filter((r) => !r.redirigeVers && r.chemin !== '*');
const redirections = uniques.filter((r) => r.redirigeVers);

const carte = {
  genereLe: new Date().toISOString(),
  source: 'src/App.tsx',
  resume: {
    routesTotales: uniques.length,
    pagesVisitables: visitables.length,
    redirections: redirections.length,
    avecPermission: visitables.filter((r) => r.permission).length,
    avecBarriereForfait: visitables.filter((r) => r.forfait).length,
    avecBarriereModule: visitables.filter((r) => r.module).length,
    horsMenu: visitables.filter((r) => !r.dansLeMenu).length,
  },
  // Les pages à paramètre (/clients/:id) exigent un identifiant réel :
  // le robot devra en fabriquer un avant de les visiter.
  pages: visitables.map((r) => ({ ...r, aParametre: r.chemin.includes(':') })),
  redirections,
  menu,
};

fs.writeFileSync(path.join(RACINE, 'qa-carte.json'), JSON.stringify(carte, null, 2), 'utf8');

console.log('\n═══ Carte du territoire ═══\n');
console.log(`  Routes déclarées      ${carte.resume.routesTotales}`);
console.log(`  Pages visitables      ${carte.resume.pagesVisitables}`);
console.log(`    dont à paramètre    ${carte.pages.filter((p) => p.aParametre).length}  (exigent un identifiant réel)`);
console.log(`    dont hors menu      ${carte.resume.horsMenu}  (inatteignables sans URL directe)`);
console.log(`  Redirections          ${carte.resume.redirections}`);
console.log('');
console.log(`  Avec permission       ${carte.resume.avecPermission}`);
console.log(`  Barrière de forfait   ${carte.resume.avecBarriereForfait}`);
console.log(`  Barrière de module    ${carte.resume.avecBarriereModule}`);

const sansPage = visitables.filter((r) => !r.page);
if (sansPage.length) {
  console.log('');
  console.log(`  ⚠ ${sansPage.length} route(s) sans composant identifié :`);
  sansPage.slice(0, 8).forEach((r) => console.log(`      ${r.chemin}`));
}

console.log('\n  → qa-carte.json\n');
