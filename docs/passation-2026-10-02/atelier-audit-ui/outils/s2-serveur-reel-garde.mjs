// Démarre le VRAI serveur (server/index.ts) du worktree de correctifs, sans tâche de fond ni fournisseur,
// et vérifie la garde avec un vrai jeton de technicien (bureau de test staging). Arrête le serveur à la fin.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { session, etat } from './nav.mjs';

const RACINE = 'D:/lume-uiaudit/wt-lumi';
const PORT = 3141;
const env = {
  ...process.env, NODE_ENV: 'development', PORT: String(PORT), API_PORT: String(PORT), LUME_TACHES_DE_FOND: 'off',
  AGENT_JWT_SECRET: randomBytes(48).toString('base64'),
  QA_REDIRECT_TO: '', QA_REDIRECT_EMAIL: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
  RESEND_API_KEY: '', SES_SMTP_USER: '', SES_SMTP_PASS: '', COURRIEL_FOURNISSEUR: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9',
  SLACK_BOT_TOKEN: '', STRIPE_SECRET_KEY: '', PAYPAL_CLIENT_ID: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', SENTRY_DSN: '',
  SUPABASE_URL_PROD: '', SUPABASE_SERVICE_ROLE_KEY_PROD: '',
};
const p = spawn(process.execPath, [`${RACINE}/node_modules/tsx/dist/cli.mjs`, 'server/index.ts'], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let journal = '';
p.stdout.on('data', (d) => { journal += d; }); p.stderr.on('data', (d) => { journal += d; });
const tuer = () => { try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà mort */ } };
process.once('exit', tuer);
try {
  const base = `http://127.0.0.1:${PORT}`;
  const fin = Date.now() + 150_000;
  for (;;) {
    if (p.exitCode !== null) throw new Error(`le serveur s'est arrêté (code ${p.exitCode})\n${journal.slice(-1500)}`);
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) })).ok) break; } catch { /* pas encore prêt */ }
    if (Date.now() > fin) throw new Error(`pas de réponse\n${journal.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log('serveur démarré sur', base);
  const e = etat();
  const tech = (await session(e.comptes.techA.email)).access_token;
  const proprio = (await session(e.comptes.proprioA.email)).access_token;
  const appel = async (jeton, chemin, methode = 'GET') => {
    const r = await fetch(base + chemin, { method: methode, headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), 'x-org-id': e.orgA, 'x-requested-with': 'XMLHttpRequest', 'Content-Type': 'application/json' }, body: methode === 'GET' ? undefined : '{}' });
    return `${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 90)}`;
  };
  for (const c of ['/api/automations/pause', '/api/automations/pause/', '/API/automations/pause', '/api/Automations/pause', '/api//automations/pause/']) {
    console.log(`technicien   GET  ${c.padEnd(34)} → ${await appel(tech, c)}`);
  }
  console.log(`propriétaire GET  ${'/API/Automations/Pause/'.padEnd(34)} → ${await appel(proprio, '/API/Automations/Pause/')}`);
  console.log(`sans jeton   GET  ${'/api/automations/pause/'.padEnd(34)} → ${await appel(null, '/api/automations/pause/')}`);
  for (const c of ['/api/automations/events/lead-created', '/api/automations/events/lead-created/', '/API/automations/events/lead-created']) {
    console.log(`technicien   POST ${c.padEnd(40)} → ${await appel(tech, c, 'POST')}`);
    console.log(`sans jeton   POST ${c.padEnd(40)} → ${await appel(null, c, 'POST')}`);
  }
} catch (err) {
  console.log('ÉCHEC :', String(err).slice(0, 1800));
} finally { tuer(); }
