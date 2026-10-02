#!/usr/bin/env node
/**
 * Rejoue une ou plusieurs specs Playwright de la tournée d'interface (lecture
 * seule, dans `D:/lume-uiaudit/wt-lumi`) contre MES serveurs locaux — recette
 * de `D:/lume-final/notes/REJOUER-UNE-SPEC-E2E.md`.
 *
 *   node scripts/qa/finale/t/rejouer-spec.mjs modeles/04-courriel.spec.ts -g "MSG-017"
 *
 * Les clés viennent du `.env.local` de ce worktree (pile LOCALE) : elles ne
 * sont jamais affichées. Rien n'est démarré ni arrêté ici : l'API (3498) et
 * Vite (5498) doivent tourner (`node D:/lume-final/outils/serveurs.mjs …`).
 *
 * LE VERDICT. La pile locale n'a pas de Realtime : chaque page journalise
 * « WebSocket connection to …/realtime/v1/websocket failed … 404 », et le
 * moniteur du banc compte ces lignes comme des problèmes du produit. Un test
 * dont le CORPS passe finit donc « failed » sur le seul moniteur. Ce lanceur
 * lit le rapport et distingue :
 *   VERT          — passé ;
 *   CORPS VERT    — toutes les attentes du test ont passé ; seul le moniteur a
 *                   relevé le WebSocket de Realtime (bruit de la pile locale) ;
 *   ROUGE         — une attente du test est tombée (première ligne de l'erreur).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wt = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const env = Object.fromEntries(readFileSync(join(wt, '.env.local'), 'utf8').split(/\r?\n/)
  .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!/localhost|127\.0\.0\.1/.test(String(env.VITE_SUPABASE_URL || ''))) {
  console.error('REFUS : ce lanceur ne sert que la pile LOCALE.');
  process.exit(1);
}
const SPECS = 'D:/lume-uiaudit/wt-lumi';
const r = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '-c', 'e2e/automations/playwright.config.ts',
  ...process.argv.slice(2), '--project=bureau', '--reporter=json',
], {
  cwd: SPECS,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'http://127.0.0.1:44921',
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? '',
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    E2E_BASE: process.env.T_BASE || 'http://127.0.0.1:5498',
    E2E_JEU: 't',
    E2E_WORKERS: '1',
    E2E_SORTIES: 'D:/lume-final/sorties/e2e-t',
    PLAYWRIGHT_BROWSERS_PATH: 'D:/lume-uiaudit/pw-browsers',
  },
});

let rapport;
try {
  rapport = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
} catch {
  console.error('rapport illisible :\n', (r.stdout || '').slice(0, 2000), '\n', (r.stderr || '').slice(0, 2000));
  process.exit(2);
}

const sansCouleur = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');
/** Les lignes « · … » d'une erreur du moniteur : uniquement le WebSocket de Realtime ? */
function seulementRealtime(message) {
  const m = sansCouleur(message);
  if (!/Le moniteur \(.*\) a relevé/.test(m)) return false;
  const puces = m.split('\n').filter((l) => l.trim().startsWith('·'));
  return puces.length > 0 && puces.every((l) => /WebSocket connection to 'ws:\/\/[^']*\/realtime\/v1\/websocket/.test(l));
}

const lignes = [];
const visiter = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const dernier = t.results?.[t.results.length - 1];
      const erreurs = (dernier?.errors ?? []).map((e) => sansCouleur(e.message));
      const ou = `${spec.file}:${spec.line}`;
      if (dernier?.status === 'passed') lignes.push(['VERT', ou, spec.title, '']);
      else if (erreurs.length && erreurs.every(seulementRealtime)) lignes.push(['CORPS VERT', ou, spec.title, 'moniteur : WebSocket de Realtime (absent de la pile locale)']);
      else lignes.push(['ROUGE', ou, spec.title, (erreurs.find((e) => !seulementRealtime(e)) ?? dernier?.status ?? '').split('\n').slice(0, 6).join(' | ').slice(0, 700)]);
    }
  }
  for (const s of suite.suites ?? []) visiter(s);
};
for (const s of rapport.suites ?? []) visiter(s);

for (const [verdict, ou, titre, detail] of lignes) {
  console.log(`${verdict.padEnd(10)} ${ou}  ${titre}${detail ? `\n           ${detail}` : ''}`);
}
const compte = (v) => lignes.filter((l) => l[0] === v).length;
console.log(`\n${lignes.length} test(s) : ${compte('VERT')} vert(s), ${compte('CORPS VERT')} corps vert(s), ${compte('ROUGE')} rouge(s)`);
process.exit(compte('ROUGE') ? 1 : 0);
