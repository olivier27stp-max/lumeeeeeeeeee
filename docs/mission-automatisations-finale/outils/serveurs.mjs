#!/usr/bin/env node
/**
 * Lance l'API Express et Vite d'un worktree contre la PILE LOCALE, pour piloter l'app au vrai
 * navigateur. Reste au premier plan (à lancer en arrière-plan) ; Ctrl+C ou `kill` arrête les deux.
 *
 *   node D:/lume-final/outils/serveurs.mjs <worktree> <portApi> <portVite> [--lumi] [--fond]
 *
 *   --lumi : garde la clé Anthropic (Lumi répond avec le vrai modèle). Sans elle : pas d'IA.
 *   --fond : laisse tourner les tâches de fond (file planifiée, événements de base). Sans elle :
 *            LUME_TACHES_DE_FOND=off — les tests font avancer le moteur eux-mêmes.
 *
 * Aucun fournisseur d'envoi : Twilio vide, courriel vers un port fermé (127.0.0.1:9). Le bac à
 * sable des envois est actif (BAC_A_SABLE_EN_TEST=1).
 * Écrit D:/lume-final/sorties/serveurs-<portApi>.json (PID, adresses) et les journaux à côté.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [wtBrut, portApi, portVite, ...drapeaux] = process.argv.slice(2);
if (!wtBrut || !portApi || !portVite) { console.error('usage : serveurs.mjs <worktree> <portApi> <portVite> [--lumi] [--fond]'); process.exit(2); }
const wt = resolve(wtBrut);
const SORTIES = 'D:/lume-final/sorties';
const fichierEnv = join(wt, '.env.local');
if (!existsSync(fichierEnv)) { console.error(`${fichierEnv} absent (node D:/lume-final/outils/env-local.mjs <chemin>)`); process.exit(1); }
const env = Object.fromEntries(readFileSync(fichierEnv, 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!String(env.VITE_SUPABASE_URL || '').includes('localhost')) { console.error('REFUS : ce lanceur ne sert que la pile LOCALE.'); process.exit(1); }

const base = { ...process.env, ...env };
const envApi = {
  ...base,
  NODE_ENV: 'development', PORT: portApi, API_PORT: portApi,
  LUME_TACHES_DE_FOND: drapeaux.includes('--fond') ? 'on' : 'off',
  BAC_A_SABLE_EN_TEST: '1', SUBSCRIPTION_GUARD: 'enforce',
  PUBLIC_URL: `http://127.0.0.1:${portVite}`, FRONTEND_URL: `http://127.0.0.1:${portVite}`,
  QA_REDIRECT_TO: '', QA_REDIRECT_EMAIL: '',
  TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
  TWILIO_PROVISIONING_API_KEY_SID: '', TWILIO_PROVISIONING_API_KEY_SECRET: '',
  RESEND_API_KEY: '', SES_SMTP_USER: '', SES_SMTP_PASS: '', SES_WEBHOOK_TOKEN: '',
  COURRIEL_FOURNISSEUR: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9', SMTP_USER: 'piege@lume-qa.test', SMTP_PASS: 'piege',
  SLACK_BOT_TOKEN: '', SLACK_SIGNING_SECRET: '', SLACK_SUPPORT_CHANNEL_ID: '',
  STRIPE_SECRET_KEY: '', STRIPE_AUDIT_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
  GEMINI_API_KEY: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', SENTRY_DSN: '',
  SUPABASE_URL_PROD: '', SUPABASE_SERVICE_ROLE_KEY_PROD: '', SUPABASE_PROJECT_REF_PROD: '',
  ANTHROPIC_API_KEY: drapeaux.includes('--lumi') ? (env.ANTHROPIC_API_KEY || '') : '',
};
const envVite = { ...base, API_PORT: portApi, DISABLE_HMR: 'true', VITE_SENTRY_DSN: '', VITE_STRIPE_PUBLISHABLE_KEY: '' };

function lancer(nom, args, e) {
  const journal = join(SORTIES, `${nom}-${portApi}.log`);
  const sortie = createWriteStream(journal, { flags: 'w' });
  const p = spawn(process.execPath, args, { cwd: wt, env: e, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  p.stdout.pipe(sortie); p.stderr.pipe(sortie);
  p.once('exit', (code) => { sortie.write(`\n[${nom}] terminé (code ${code})\n`); });
  return p;
}
const tuer = (p) => { if (!p?.pid) return; try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill('SIGTERM'); } catch { /* déjà terminé */ } };

const api = lancer('api', [join(wt, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], envApi);
const vite = lancer('vite', [join(wt, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', portVite, '--strictPort', '--host', '127.0.0.1'], envVite);
const arreter = () => { tuer(vite); tuer(api); };
process.once('exit', arreter);
// Un des deux meurt (API qui refuse de démarrer, port pris) : on arrête l'autre et on sort tout de
// suite, au lieu de laisser un Vite orphelin et d'attendre 150 s.
for (const [nom, p] of [['api', api], ['vite', vite]]) {
  p.once('exit', (code) => { console.error(`[${nom}] s'est arrêté (code ${code}) — voir ${SORTIES}/${nom}-${portApi}.log`); process.exit(1); });
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));

async function attendre(url, delaiMs) {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* pas encore */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
const okApi = await attendre(`http://127.0.0.1:${portApi}/api/health`, 150_000);
const okVite = await attendre(`http://127.0.0.1:${portVite}/`, 150_000);
const etat = { wt, api: `http://127.0.0.1:${portApi}`, app: `http://127.0.0.1:${portVite}`, pid: process.pid, pidApi: api.pid, pidVite: vite.pid, lumi: drapeaux.includes('--lumi'), fond: drapeaux.includes('--fond'), pret: okApi && okVite, depuis: new Date().toISOString() };
writeFileSync(join(SORTIES, `serveurs-${portApi}.json`), JSON.stringify(etat, null, 1));
console.log(JSON.stringify(etat));
if (!etat.pret) { console.error(`serveurs non prêts (API ${okApi}, Vite ${okVite}) — voir ${SORTIES}/api-${portApi}.log et vite-${portApi}.log`); process.exit(1); }
setInterval(() => {}, 60_000); // reste en vie tant qu'on ne l'arrête pas
