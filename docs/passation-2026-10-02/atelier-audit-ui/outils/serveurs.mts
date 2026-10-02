/**
 * Serveurs locaux de l'audit d'interface des Automatisations — longue durée.
 *
 *   cd D:/lume-uiaudit/wt
 *   QA_AUTO_SUFFIXE=uiaudit node --env-file=.env.local node_modules/tsx/dist/cli.mjs ../outils/serveurs.mts [--lumi]
 *
 * Même environnement que le harnais de la suite (tests/automations-suite/
 * harnais/serveurs-ui.ts) : API Express SANS tâche de fond, SANS fournisseur
 * réel (valeurs vides, SMTP sur un port fermé), bureaux de test en bac à sable
 * sur STAGING. `--lumi` garde ANTHROPIC_API_KEY (phase 5) et change de ports.
 *
 * Écrit D:/lume-uiaudit/sorties/serveurs[-lumi].json (URL, bureaux, comptes,
 * PID) et reste en vie jusqu'à ce qu'on tue ce processus (arrêt propre des
 * deux enfants).
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { assurerBureauTest, COMPTES, REF_PROD } from '../wt/tests/automations-suite/harnais/bureau-test';

const LUMI = process.argv.includes('--lumi');
const PORT_API = LUMI ? 3113 : 3112;
const PORT_VITE = LUMI ? 5184 : 5183;
const RACINE = process.cwd();
const SORTIES = 'D:/lume-uiaudit/sorties';
const JOURNAUX = join(SORTIES, LUMI ? 'serveurs-lumi' : 'serveurs');
mkdirSync(JOURNAUX, { recursive: true });

const url = process.env.VITE_SUPABASE_URL ?? '';
if (!url || url.includes(REF_PROD)) throw new Error('REFUS : staging seulement.');

function portOccupe(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); ok(true); });
    s.once('error', () => ok(false));
  });
}
async function attendreHttp(u: string, delaiMs: number, quoi: string) {
  const fin = Date.now() + delaiMs;
  let derniere = '';
  while (Date.now() < fin) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(5000) }); if (r.ok) return; derniere = `HTTP ${r.status}`; }
    catch (e) { derniere = e instanceof Error ? e.message : String(e); }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${quoi} ne répond pas sur ${u} (${derniere})`);
}
function tuerArbre(p: ChildProcess | null) {
  if (!p?.pid || p.exitCode !== null) return;
  try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà terminé */ }
}
function lancer(nom: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const sortie = createWriteStream(join(JOURNAUX, `${nom}.log`), { flags: 'w' });
  const p = spawn(process.execPath, args, { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  p.stdout?.pipe(sortie); p.stderr?.pipe(sortie);
  return p;
}

for (const port of [PORT_API, PORT_VITE]) if (await portOccupe(port)) throw new Error(`Port ${port} déjà occupé.`);

// Bureaux de test (idempotent) : le bac à sable est posé AVANT tout serveur.
const bureau = await assurerBureauTest();
for (const id of Object.values(bureau.users)) {
  await bureau.admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
}
const { data: bac } = await bureau.admin.from('orgs_envois_simules').select('org_id, mode').in('org_id', [bureau.orgA, bureau.orgB]);
if ((bac ?? []).length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable.');

const base: NodeJS.ProcessEnv = { ...process.env };
const envApi: NodeJS.ProcessEnv = {
  ...base,
  NODE_ENV: 'development',
  PORT: String(PORT_API), API_PORT: String(PORT_API),
  LUME_TACHES_DE_FOND: 'off',
  SUBSCRIPTION_GUARD: 'enforce',
  AGENT_JWT_SECRET: process.env.AGENT_JWT_SECRET || randomBytes(48).toString('base64'),
  PUBLIC_URL: `http://127.0.0.1:${PORT_VITE}`, FRONTEND_URL: `http://127.0.0.1:${PORT_VITE}`,
  QA_REDIRECT_TO: '', QA_REDIRECT_EMAIL: '',
  TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
  TWILIO_PROVISIONING_API_KEY_SID: '', TWILIO_PROVISIONING_API_KEY_SECRET: '',
  RESEND_API_KEY: '', SES_SMTP_USER: '', SES_SMTP_PASS: '', SES_WEBHOOK_TOKEN: '',
  COURRIEL_FOURNISSEUR: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9', SMTP_USER: 'piege@lume-qa.test', SMTP_PASS: 'piege',
  SLACK_BOT_TOKEN: '', SLACK_SIGNING_SECRET: '', SLACK_SUPPORT_CHANNEL_ID: '',
  STRIPE_SECRET_KEY: '', STRIPE_AUDIT_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
  GEMINI_API_KEY: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '',
  SENTRY_DSN: '',
  SUPABASE_URL_PROD: '', SUPABASE_SERVICE_ROLE_KEY_PROD: '', SUPABASE_PROJECT_REF_PROD: '',
  ...(LUMI ? {} : { ANTHROPIC_API_KEY: '' }),
};
const envVite: NodeJS.ProcessEnv = { ...base, API_PORT: String(PORT_API), DISABLE_HMR: 'true', VITE_SENTRY_DSN: '', VITE_STRIPE_PUBLISHABLE_KEY: '' };

const tsx = join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vite = join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js');
const api = lancer('api', [tsx, 'server/index.ts'], envApi);
const front = lancer('vite', [vite, '--port', String(PORT_VITE), '--strictPort', '--host', '127.0.0.1'], envVite);
const arreter = () => { tuerArbre(front); tuerArbre(api); };
process.once('exit', arreter);
process.once('SIGINT', () => { arreter(); process.exit(0); });
process.once('SIGTERM', () => { arreter(); process.exit(0); });

try {
  await Promise.all([
    attendreHttp(`http://127.0.0.1:${PORT_API}/api/health`, 150_000, 'API'),
    attendreHttp(`http://127.0.0.1:${PORT_VITE}/`, 150_000, 'Vite'),
  ]);
  await attendreHttp(`http://127.0.0.1:${PORT_VITE}/api/health`, 30_000, 'proxy Vite → API');
} catch (e) { arreter(); throw e; }

const etat = {
  demarre: new Date().toISOString(),
  pid: process.pid,
  base: `http://127.0.0.1:${PORT_VITE}`,
  api: `http://127.0.0.1:${PORT_API}`,
  lumi: LUMI,
  orgA: bureau.orgA, orgB: bureau.orgB,
  comptes: Object.fromEntries(Object.entries(COMPTES).map(([k, c]) => [k, { email: c.email, role: c.role, id: bureau.users[k as keyof typeof COMPTES] }])),
  journaux: JOURNAUX,
};
writeFileSync(join(SORTIES, LUMI ? 'serveurs-lumi.json' : 'serveurs.json'), JSON.stringify(etat, null, 2));
console.log('PRÊT', JSON.stringify(etat));
setInterval(() => { if (api.exitCode !== null || front.exitCode !== null) { console.log('un serveur est mort', api.exitCode, front.exitCode); arreter(); process.exit(1); } }, 5000);
