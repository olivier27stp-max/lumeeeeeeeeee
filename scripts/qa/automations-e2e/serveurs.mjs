#!/usr/bin/env node
/**
 * Tient DEBOUT le proxy, l'API et Vite de la pile locale, pour enchaîner plusieurs passes
 * (`lancer.mjs` réutilise des serveurs qui répondent déjà au lieu d'en redémarrer à chaque fois).
 *
 *   node scripts/qa/automations-e2e/serveurs.mjs      (Ctrl+C pour tout arrêter)
 *
 * Même environnement que lancer.mjs (construit à partir de rien), mêmes ceintures que la suite
 * `npm run test:automations` (tests/automations-suite/harnais/serveurs-ui.ts) : API sans tâche de fond,
 * aucun fournisseur réel.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { envLocal } from './local.mjs';

const racine = process.cwd();
const sorties = resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'));
const env = envLocal(sorties);
const enfants = [
  spawn(process.execPath, [join(racine, 'scripts/qa/automations-e2e/proxy.mjs')], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [join(racine, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(racine, 'scripts/qa/automations-e2e/serveurs-tenir.mts')], { cwd: racine, env, stdio: 'inherit', windowsHide: true }),
];
const arreter = () => { for (const e of enfants) { try { e.kill(); } catch { /* déjà arrêté */ } } };
process.once('SIGINT', () => { arreter(); process.exit(130); });
process.once('SIGTERM', () => { arreter(); process.exit(143); });
enfants[1].once('exit', (code) => { arreter(); process.exit(code ?? 1); });
