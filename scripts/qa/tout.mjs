#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   TOUT D'UN COUP — chaque instrument du projet, dans l'ordre, une
   seule liste à la fin.

   POURQUOI
   Les bugs ne vivent pas au même endroit : le catalogue de la base,
   les données entre elles, le code, le fuseau horaire, une page
   ouverte sans session. Chacun demande son instrument. Lancés un par
   un, au fil des questions, ils sortent les bugs au compte-gouttes.
   Ici ils tournent tous, puis on parle.

   TROIS FAMILLES
     1. Statique   — typecheck front + serveur, tests unitaires
     2. Base       — références du code vers le schéma, objets cassés,
                     cohérence code ↔ base, invariants métier
                     (staging, puis prod en LECTURE SEULE)
     3. Comportement (staging, front local) — fuite entre orgs,
                     parcours client → facture, liens publics,
                     formulaires, boutons, inscription, mobile

   Ce que la batterie NE couvre PAS, écrit pour qu'on ne se raconte
   pas d'histoire : le paiement Stripe en production, l'envoi réel de
   SMS et de courriels, l'application mobile native.

   Le front et l'API sont démarrés ici s'ils ne tournent pas déjà
   (ports 5174 et 3002), et arrêtés à la fin dans ce cas.

   Usage : npm run qa:tout            (tout)
           QA_TOUT=statique,base      (une ou deux familles)
   ═══════════════════════════════════════════════════════════════ */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const RACINE = process.cwd();
const FRONT = 'http://localhost:5174';
const FAMILLES = (process.env.QA_TOUT || 'statique,base,comportement').split(',');
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const ETAPES = [
  // ── 1. statique ──
  { famille: 'statique', nom: 'typecheck front', cmd: NPX, args: ['tsc', '--noEmit', '-p', 'tsconfig.json'] },
  { famille: 'statique', nom: 'typecheck serveur', cmd: NPX, args: ['tsc', '--noEmit', '-p', 'tsconfig.server.json'] },
  { famille: 'statique', nom: 'tests unitaires (vitest)', cmd: NPX, args: ['vitest', 'run'] },
  // ── 2. base ──
  { famille: 'base', nom: 'références code → schéma (staging)', cmd: NPM, args: ['run', 'check:schema-refs'] },
  { famille: 'base', nom: 'objets cassés (staging)', cmd: NPM, args: ['run', 'check:broken-objects'] },
  { famille: 'base', nom: 'cohérence code ↔ base (staging)', cmd: NPM, args: ['run', 'check:db-coherence'] },
  { famille: 'base', nom: 'invariants métier (staging)', cmd: NPM, args: ['run', 'qa:invariants'] },
  { famille: 'base', nom: 'invariants métier (PROD, lecture seule)', cmd: NPM, args: ['run', 'qa:invariants', '--', '--prod'] },
  // ── 3. comportement ──
  { famille: 'comportement', nom: 'fuite entre organisations', cmd: NPM, args: ['run', 'qa:fuite'], front: true },
  { famille: 'comportement', nom: 'parcours client → devis → job → facture', cmd: NPM, args: ['run', 'qa:parcours'], front: true },
  { famille: 'comportement', nom: 'liens publics (devis, paiement, portail)', cmd: NPM, args: ['run', 'qa:liens'], front: true },
  { famille: 'comportement', nom: 'formulaires de réglages', cmd: NPM, args: ['run', 'qa:formulaires'], front: true },
  { famille: 'comportement', nom: 'inscription d un compte neuf', cmd: 'node', args: ['--env-file=.env.local', 'scripts/qa/verifier-inscription.mjs'], front: true },
  { famille: 'comportement', nom: 'mobile (390 px)', cmd: 'node', args: ['--env-file=.env.local', 'scripts/qa/mobile.mjs'], front: true },
  { famille: 'comportement', nom: 'boutons (toutes les pages du menu)', cmd: NPM, args: ['run', 'qa:boutons'], front: true },
];

function ecouteSur(port, host) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}
// Vite peut n'écouter qu'en IPv6 (::1) : on sonde les deux.
async function ecoute(port) { return (await ecouteSur(port, '127.0.0.1')) || (await ecouteSur(port, '::1')); }
async function attendre(port, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await ecoute(port)) return true; await new Promise((r) => setTimeout(r, 1000)); }
  return false;
}

const lances = [];
async function demarrerFront() {
  const journal = (nom) => fs.openSync(path.join(RACINE, `qa-${nom}.log`), 'w');
  if (!(await ecoute(3002))) {
    console.log('  · démarrage de l API (3002)… (journal : qa-api.log)');
    const j = journal('api');
    lances.push(spawn(NPX, ['tsx', 'server/index.ts'], { cwd: RACINE, stdio: ['ignore', j, j], shell: process.platform === 'win32', windowsHide: true }));
  }
  if (!(await ecoute(5174))) {
    console.log('  · démarrage de Vite (5174)… (journal : qa-vite.log)');
    const j = journal('vite');
    lances.push(spawn(NPX, ['vite', '--host', '127.0.0.1', '--port=5174', '--strictPort'], { cwd: RACINE, stdio: ['ignore', j, j], shell: process.platform === 'win32', windowsHide: true }));
  }
  const ok = (await attendre(3002, 60000)) && (await attendre(5174, 60000));
  if (!ok) throw new Error('front ou API injoignable');
  await new Promise((r) => setTimeout(r, 3000));
}

function executer(etape) {
  const t0 = Date.now();
  const r = spawnSync(etape.cmd, etape.args, {
    cwd: RACINE, encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, FRONTEND_URL: FRONT, QA_MAX_BOUTONS: process.env.QA_MAX_BOUTONS || '40' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const sortie = (r.stdout || '') + (r.stderr || '');
  const lignes = sortie.split('\n');
  // Ce qu'on garde comme détail : les lignes de refus, d'erreur, de bilan.
  const detail = lignes.filter((l) => /✗|!!|ERR|error TS|FAIL|Error:|échec|ÉCHEC|violé|passées|Boutons trouvés|bouton_mort|page_cassee|erreur_silencieuse/.test(l)).slice(0, 40);
  return { ...etape, code: r.status, ok: r.status === 0, duree: Math.round((Date.now() - t0) / 1000), detail, sortie };
}

const resultats = [];
console.log('\n═══ Lume — toute la batterie ═══\n');
try {
  let frontPret = false;
  for (const e of ETAPES) {
    if (!FAMILLES.includes(e.famille)) continue;
    if (process.env.QA_ETAPES && !process.env.QA_ETAPES.split(',').some((m) => e.nom.includes(m))) continue;
    if (e.front && !frontPret) { await demarrerFront(); frontPret = true; }
    process.stdout.write(`  ${e.nom.padEnd(48)}`);
    const r = executer(e);
    resultats.push(r);
    console.log(`${r.ok ? '✓' : '✗'}  ${r.duree}s`);
  }
} finally {
  for (const p of lances) { try { process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' }) : p.kill(); } catch {}
  }
}

/* ── Le rapport : une seule liste ─────────────────────────────── */
const rates = resultats.filter((r) => !r.ok);
let md = `# Lume — batterie complète du ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n\n`;
md += `${resultats.length - rates.length}/${resultats.length} instruments verts.\n\n`;
md += '| Instrument | Famille | Résultat | Durée |\n|---|---|---|---|\n';
for (const r of resultats) md += `| ${r.nom} | ${r.famille} | ${r.ok ? '✓' : '✗'} | ${r.duree}s |\n`;
if (rates.length) {
  md += '\n## Ce qui reste\n';
  for (const r of rates) {
    md += `\n### ${r.nom}\n\n`;
    md += r.detail.length ? r.detail.map((l) => '    ' + l.trim()).join('\n') + '\n' : '    (voir la sortie complète dans qa-rapport-tout.log)\n';
  }
}
md += '\n## Non couvert par cette batterie\n\n- Le paiement Stripe en production (exige un compte Connect ; staging n en a pas).\n- L envoi réel de SMS et de courriels.\n- L application mobile native (ici : navigateur à 390 px).\n';
fs.writeFileSync(path.join(RACINE, 'qa-rapport-tout.md'), md);
fs.writeFileSync(path.join(RACINE, 'qa-rapport-tout.log'), resultats.map((r) => `\n\n══════ ${r.nom} (code ${r.code}) ══════\n${r.sortie}`).join(''));
console.log(`\n${resultats.length - rates.length}/${resultats.length} instruments verts → qa-rapport-tout.md`);
process.exit(rates.length ? 1 : 0);
