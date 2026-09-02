#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LA CAMPAGNE — plusieurs passages complets, pour attraper ce qui
   ne casse pas à tous les coups.

   POURQUOI RÉPÉTER
   Un bug qui apparaît une fois sur trois est le pire de tous : on
   le voit, on ne le reproduit pas, on conclut qu'on a rêvé. Ce sont
   souvent des courses entre deux chargements, des délais réseau,
   des états mal nettoyés d'une page à l'autre.

   Un seul passage ne les voit pas. Trois passages les révèlent.

   CE QU'ELLE PRODUIT
   Chaque constat porte sa fréquence :
     3/3  systématique — se reproduit à tous les coups
     1/3  INTERMITTENT — le plus sournois, à traiter en priorité

   Usage : npm run qa:campagne          (3 passages)
           QA_PASSAGES=5 npm run qa:campagne
   ═══════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();
const PASSAGES = Number(process.env.QA_PASSAGES || 3);

function lancer(script, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--env-file=.env.local', script], {
      cwd: RACINE,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    p.stdout.on('data', (d) => { sortie += d; });
    p.stderr.on('data', (d) => { sortie += d; });
    p.on('close', (code) => resolve({ code, sortie }));
  });
}

const lire = (nom) => {
  const p = path.join(RACINE, nom);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

/* Un constat est identifié par sa CAUSE, pas par sa formulation :
   « 403 sur /api/x » vu depuis deux boutons reste un seul constat. */
function cle(page, texte, detail) {
  const appel = String(detail).match(/(\d{3})\s+\S*?(\/(?:api|rest)\/[a-z0-9/_-]+)/i);
  if (appel) return `${appel[1]} sur ${appel[2]}`;
  return `${page} · ${texte} · ${String(detail).replace(/\d+/g, 'N').slice(0, 60)}`;
}

const constats = new Map();
const noter = (k, passage, description) => {
  if (!constats.has(k)) constats.set(k, { description, passages: new Set() });
  constats.get(k).passages.add(passage);
};

console.log(`\n═══ Campagne — ${PASSAGES} passages complets ═══\n`);

for (let n = 1; n <= PASSAGES; n++) {
  console.log(`── Passage ${n}/${PASSAGES} ──`);

  // 1. L'explorateur : chaque page s'affiche-t-elle ?
  process.stdout.write('  exploration… ');
  await lancer('scripts/qa/explorer.mjs');
  const exp = lire('qa-exploration.json');
  if (exp) {
    console.log(`${exp.resume.sansProbleme}/${exp.resume.pagesVisitees} pages sans problème`);
    for (const p of exp.pages.filter((x) => x.anomalies?.length)) {
      const echec = p.requetesEchouees?.[0];
      const quoi = echec
        ? `appel en échec ${echec.code} sur ${String(echec.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`
        : p.anomalies[0];
      noter(cle(p.chemin, '', quoi), n, `**${p.chemin}** — ${quoi}`);
    }
  } else {
    console.log('échec');
  }

  // 2. Le testeur de boutons : chacun fait-il ce qu'il annonce ?
  process.stdout.write('  boutons…     ');
  await lancer('scripts/qa/boutons.mjs', { QA_MAX_BOUTONS: '30' });
  const bt = lire('qa-boutons.json');
  if (bt) {
    const r = bt.resume;
    console.log(`${r.ok || 0}/${r.boutonsTestes} boutons corrects`);
    for (const page of bt.pages || []) {
      for (const b of page.resultats || []) {
        if (!['bouton_mort', 'page_cassee', 'erreur_silencieuse', 'destination_incoherente', 'destination_douteuse'].includes(b.verdict)) continue;
        const nom = b.texte || b.etiquette || '(sans texte)';
        noter(cle(page.chemin, nom, b.detail), n, `**${page.chemin}** — « ${nom} » : ${b.detail}`);
      }
    }
  } else {
    console.log('échec');
  }

  // Laisser le serveur souffler entre deux passages : enchaînés sans pause,
  // ils le saturent et produisent des erreurs 429 qui n'ont rien à voir avec
  // l'application. 22 faux constats sur 49 au premier essai.
  if (n < PASSAGES) {
    process.stdout.write('  pause…       ');
    await new Promise((r) => setTimeout(r, 20000));
    console.log('20 s');
  }

  console.log('');
}

/* ── Bilan : ce qui se reproduit, ce qui est intermittent ─────── */

const tous = [...constats.entries()]
  .map(([k, v]) => ({ k, ...v, n: v.passages.size }))
  .sort((a, b) => b.n - a.n);

const systematiques = tous.filter((x) => x.n === PASSAGES);
const intermittents = tous.filter((x) => x.n < PASSAGES);

console.log('═'.repeat(62));
console.log(`  Constats distincts   ${tous.length}`);
console.log(`  Systématiques        ${systematiques.length}  (à tous les passages)`);
console.log(`  Intermittents        ${intermittents.length}  (pas à tous — les plus sournois)`);
console.log('');

if (systematiques.length) {
  console.log('── Systématiques ──');
  systematiques.forEach((x) => console.log(`  ${PASSAGES}/${PASSAGES}  ${x.description}`));
  console.log('');
}
if (intermittents.length) {
  console.log('── Intermittents — à traiter en priorité ──');
  intermittents.forEach((x) => console.log(`  ${x.n}/${PASSAGES}  ${x.description}`));
  console.log('');
}
if (!tous.length) {
  console.log(`  Aucun défaut sur ${PASSAGES} passages complets.\n`);
}

fs.writeFileSync(
  path.join(RACINE, 'qa-campagne.json'),
  JSON.stringify({
    genereLe: new Date().toISOString(),
    passages: PASSAGES,
    resume: { total: tous.length, systematiques: systematiques.length, intermittents: intermittents.length },
    constats: tous.map((x) => ({ frequence: `${x.n}/${PASSAGES}`, description: x.description })),
  }, null, 2),
  'utf8',
);
console.log('  → qa-campagne.json\n');
