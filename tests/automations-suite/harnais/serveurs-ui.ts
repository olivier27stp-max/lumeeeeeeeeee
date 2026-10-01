/**
 * globalSetup du projet vitest `ui` (tests Playwright de la page
 * Automatisations) — démarre et ARRÊTE deux serveurs locaux :
 *
 *   · l'API Express (`tsx server/index.ts`) sur le port 3071, SANS tâche de
 *     fond (LUME_TACHES_DE_FOND=off : sinon elle dépilerait la file planifiée
 *     de TOUTES les entreprises de staging — ~80 courriels le 2026-09-29) et
 *     SANS fournisseur réel (valeurs VIDES, jamais absentes : config.ts relit
 *     .env.local et remettrait une variable supprimée) ;
 *   · Vite sur le port 5191, dont le proxy `/api` vise cette API.
 *
 * Multiplateforme : Windows en local (arbre de processus tué par `taskkill /T`),
 * Linux en CI (groupe de processus détaché, tué par `kill(-pid)`). Rien ne passe
 * par un shell ni par `npx` : on lance `node` sur les binaires du dépôt.
 *
 * En CI, seules VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY (staging) et ANTHROPIC_API_KEY existent : tout le
 * reste est fixé ici (secret de jeton agent éphémère, garde d'abonnement…).
 *
 * Les journaux vont HORS du dépôt (QA_UI_SORTIES, défaut : dossier temporaire
 * du système) : un fichier écrit dans le worktree ferait recharger Vite en
 * boucle.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';
import type { TestProject } from 'vitest/node';
import { assurerBureauTest, COMPTES, REF_PROD } from './bureau-test';

export const PORT_API = Number(process.env.QA_UI_PORT_API || 3071);
export const PORT_VITE = Number(process.env.QA_UI_PORT_VITE || 5191);

const RACINE = process.cwd();
export function dossierSorties(): string {
  const d = resolve(process.env.QA_UI_SORTIES || join(tmpdir(), 'lume-qa-ui'));
  if (d.toLowerCase().startsWith(RACINE.toLowerCase())) {
    throw new Error(`QA_UI_SORTIES (${d}) est DANS le dépôt : Vite rechargerait en boucle. Choisis un dossier hors du worktree.`);
  }
  mkdirSync(d, { recursive: true });
  return d;
}

/** Le port répond-il déjà ? (un serveur oublié fausserait tout le projet) */
function portOccupe(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); ok(true); });
    s.once('error', () => ok(false));
  });
}

async function attendreHttp(url: string, delaiMs: number, quoi: string, journal: string, processus?: ChildProcess | null): Promise<void> {
  const fin = Date.now() + delaiMs;
  let derniere = '';
  while (Date.now() < fin) {
    // Mort au démarrage : inutile d'attendre la fin du délai.
    if (processus && processus.exitCode !== null) {
      throw new Error(`${quoi} s'est arrêté au démarrage (code ${processus.exitCode}). Journal : ${journal}`);
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return;
      derniere = `HTTP ${r.status}`;
    } catch (e) {
      derniere = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${quoi} ne répond pas sur ${url} après ${delaiMs / 1000} s (${derniere}). Journal : ${journal}`);
}

/** Tue le processus ET ses enfants (tsx lance un second node). */
function tuerArbre(p: ChildProcess | null): void {
  if (!p?.pid || p.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-p.pid, 'SIGKILL');
    }
  } catch {
    /* déjà terminé : rien à tuer */
  }
}

function lancer(nom: string, args: string[], env: NodeJS.ProcessEnv, journal: string): ChildProcess {
  const sortie = createWriteStream(journal, { flags: 'w' });
  const p = spawn(process.execPath, args, {
    cwd: RACINE,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Linux : un groupe à lui, pour tuer tsx ET le node qu'il lance.
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  p.stdout?.pipe(sortie);
  p.stderr?.pipe(sortie);
  p.once('exit', (code, signal) => { sortie.write(`\n[${nom}] terminé (code ${code}, signal ${signal})\n`); });
  return p;
}

export default async function setup(project: TestProject) {
  // Local : .env.local (staging). CI : l'environnement suffit. Ne remplace rien.
  const fichierEnv = join(RACINE, '.env.local');
  if (existsSync(fichierEnv)) config({ path: fichierEnv, quiet: true } as never);

  const url = process.env.VITE_SUPABASE_URL ?? '';
  if (!url || url.includes(REF_PROD)) {
    throw new Error('REFUS : les tests d’interface des automatisations tournent sur STAGING seulement (VITE_SUPABASE_URL).');
  }
  if (!process.env.VITE_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY manquants.');
  }

  for (const port of [PORT_API, PORT_VITE]) {
    if (await portOccupe(port)) {
      throw new Error(`Le port ${port} est déjà occupé : un serveur d'une passe précédente tourne encore ? Arrête-le avant de relancer (aucun processus n'est réutilisé : on ne sait pas avec quel environnement il a démarré).`);
    }
  }

  // Le bureau de test (idempotent) AVANT tout serveur : le bac à sable est posé.
  const bureau = await assurerBureauTest();
  // Le consentement de localisation (demandé au 1er passage, en base) est
  // tranché d'avance : sa fenêtre captait tous les clics des tests.
  for (const id of Object.values(bureau.users)) {
    const { error } = await bureau.admin.from('profiles')
      .update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`profil de test : ${error.message}`);
  }

  const sorties = dossierSorties();
  const journalApi = join(sorties, 'api.log');
  const journalVite = join(sorties, 'vite.log');

  // Environnement commun, débarrassé des variables de vitest (le bac à sable se
  // désactive sous VITEST sans BAC_A_SABLE_EN_TEST).
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITEST') && k !== 'TINYPOOL_WORKER_ID') base[k] = v;

  const envApi: NodeJS.ProcessEnv = {
    ...base,
    NODE_ENV: 'development',
    PORT: String(PORT_API),
    API_PORT: String(PORT_API),
    LUME_TACHES_DE_FOND: 'off',
    BAC_A_SABLE_EN_TEST: '1',
    SUBSCRIPTION_GUARD: 'enforce',
    // Secret de signature des jetons agent : obligatoire au démarrage, éphémère ici.
    AGENT_JWT_SECRET: process.env.AGENT_JWT_SECRET || randomBytes(48).toString('base64'),
    PUBLIC_URL: `http://127.0.0.1:${PORT_VITE}`,
    FRONTEND_URL: `http://127.0.0.1:${PORT_VITE}`,
    // Aucun fournisseur réel : valeurs VIDES (jamais absentes, cf. config.ts).
    QA_REDIRECT_TO: '', QA_REDIRECT_EMAIL: '',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
    TWILIO_PROVISIONING_API_KEY_SID: '', TWILIO_PROVISIONING_API_KEY_SECRET: '',
    RESEND_API_KEY: '', SES_SMTP_USER: '', SES_SMTP_PASS: '', SES_WEBHOOK_TOKEN: '',
    COURRIEL_FOURNISSEUR: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9', SMTP_USER: 'piege@lume-qa.test', SMTP_PASS: 'piege',
    SLACK_BOT_TOKEN: '', SLACK_SIGNING_SECRET: '', SLACK_SUPPORT_CHANNEL_ID: '',
    // Ni paiement, ni IA, ni nuage, ni suivi d'erreurs depuis une API de test.
    STRIPE_SECRET_KEY: '', STRIPE_AUDIT_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
    ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '',
    SENTRY_DSN: '',
    // Jamais la production, même par erreur de copie.
    SUPABASE_URL_PROD: '', SUPABASE_SERVICE_ROLE_KEY_PROD: '', SUPABASE_PROJECT_REF_PROD: '',
  };
  const envVite: NodeJS.ProcessEnv = {
    ...base,
    API_PORT: String(PORT_API),
    DISABLE_HMR: 'true',
    VITE_SENTRY_DSN: '',
    VITE_STRIPE_PUBLISHABLE_KEY: '',
  };

  const tsx = join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const vite = join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js');
  let api: ChildProcess | null = null;
  let front: ChildProcess | null = null;
  const arreter = () => { tuerArbre(front); tuerArbre(api); };
  // Vitest tué (Ctrl+C, plantage) : pas de serveur orphelin.
  process.once('exit', arreter);

  try {
    api = lancer('api', [tsx, 'server/index.ts'], envApi, journalApi);
    front = lancer('vite', [vite, '--port', String(PORT_VITE), '--strictPort', '--host', '127.0.0.1'], envVite, journalVite);
    await Promise.all([
      attendreHttp(`http://127.0.0.1:${PORT_API}/api/health`, 120_000, 'L’API', journalApi, api),
      attendreHttp(`http://127.0.0.1:${PORT_VITE}/`, 120_000, 'Vite', journalVite, front),
    ]);
    // Le proxy de Vite atteint-il NOTRE API ?
    await attendreHttp(`http://127.0.0.1:${PORT_VITE}/api/health`, 30_000, 'Le proxy Vite → API', journalVite);
  } catch (e) {
    arreter();
    throw e;
  }

  project.provide('uiBase', `http://127.0.0.1:${PORT_VITE}`);
  project.provide('uiApi', `http://127.0.0.1:${PORT_API}`);
  project.provide('uiOrgA', bureau.orgA);
  project.provide('uiOrgB', bureau.orgB);
  project.provide('uiProprioA', COMPTES.proprioA.email);
  project.provide('uiSorties', sorties);
  project.provide('uiJournalApi', journalApi);

  return async () => {
    arreter();
    process.removeListener('exit', arreter);
    // Vérifie qu'aucun serveur ne survit à la passe.
    for (const port of [PORT_API, PORT_VITE]) {
      for (let i = 0; i < 20 && await portOccupe(port); i++) await new Promise((r) => setTimeout(r, 250));
      if (await portOccupe(port)) throw new Error(`Le port ${port} répond encore après l'arrêt : processus orphelin.`);
    }
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    uiBase: string;
    uiApi: string;
    uiOrgA: string;
    uiOrgB: string;
    uiProprioA: string;
    uiSorties: string;
    uiJournalApi: string;
  }
}
