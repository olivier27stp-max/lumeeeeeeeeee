#!/usr/bin/env node
/**
 * Lance les E2E Playwright de la section Automatisations (e2e/automations/) contre la pile LOCALE.
 *
 *   bash scripts/qa/automations-e2e/pile.sh                 (une fois : monte la pile)
 *   node scripts/qa/automations-e2e/lancer.mjs [arguments de `playwright test`]
 *
 * Ni staging, ni prod : la base, l'authentification et le temps réel sont des conteneurs locaux
 * (scripts/qa/automations-e2e/local.mjs). L'environnement passé aux serveurs est construit ICI, à partir
 * de rien : aucune clé de .env.local (fournisseurs, staging, prod) n'entre dans la passe.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PILE, envLocal } from './local.mjs';

const racine = process.cwd();
const sorties = resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'));
if (sorties.toLowerCase().startsWith(racine.toLowerCase())) {
  console.error(`E2E_SORTIES (${sorties}) est DANS le dépôt : Vite rechargerait en boucle.`);
  process.exit(2);
}

const repond = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500; } catch { return false; }
};
const portOuvert = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); ok(true); });
  s.once('error', () => ok(false));
});

for (const [nom, url] of [['GoTrue', `${PILE.authUrl}/health`], ['PostgREST', `${PILE.restUrl}/`], ['Realtime', `${PILE.realtimeUrl}/`]]) {
  if (!(await repond(url))) {
    console.error(`La pile locale ne répond pas (${nom}, ${url}). Lance : bash scripts/qa/automations-e2e/pile.sh`);
    process.exit(2);
  }
}

const portProxy = Number(new URL(PILE.proxyUrl).port);
let proxy = null;
if (!(await portOuvert(portProxy))) {
  proxy = spawn(process.execPath, [join(racine, 'scripts/qa/automations-e2e/proxy.mjs')], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40 && !(await portOuvert(portProxy)); i++) await new Promise((r) => setTimeout(r, 250));
}

const env = envLocal(sorties);

const cli = join(racine, 'node_modules', '@playwright', 'test', 'cli.js');
const p = spawn(process.execPath, [cli, 'test', '-c', 'e2e/automations/playwright.config.ts', ...process.argv.slice(2)], { cwd: racine, env, stdio: 'inherit', windowsHide: true });
const finir = (code) => { try { proxy?.kill(); } catch { /* déjà arrêté */ } process.exit(code ?? 1); };
p.once('exit', finir);
process.once('SIGINT', () => { try { p.kill(); } catch { /* déjà arrêté */ } finir(130); });
