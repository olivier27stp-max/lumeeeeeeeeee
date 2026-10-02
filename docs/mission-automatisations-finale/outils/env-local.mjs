#!/usr/bin/env node
/**
 * Écrit le `.env.local` de l'atelier pour la PILE LOCALE (outils/pile.sh).
 *
 *   node outils/env-local.mjs            → D:/lume-final/wt/.env.local
 *
 * Seuls passent du vrai .env.local (D:/lume-final/env.reel, hors dépôt) :
 * la clé Anthropic et le modèle de Lumi — pour jouer Lumi avec le vrai modèle.
 * AUCUN fournisseur d'envoi (Twilio, SMTP, SES, Resend), ni Stripe, ni Slack,
 * ni Gmail : sur la pile locale, rien ne peut partir même sans bac à sable.
 * Les clés Supabase sont des JWT signés avec le secret JETABLE de la pile.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LOCAL, signerJwt } from './local.mjs';

const REEL = 'D:/lume-final/env.reel';
const SORTIE = process.argv[2] || 'D:/lume-final/wt/.env.local';
if (!existsSync(REEL)) { console.error(`${REEL} introuvable`); process.exit(1); }

const reel = Object.fromEntries(
  readFileSync(REEL, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]),
);
const an = 10 * 365 * 24 * 3600;
const lignes = {
  // ── Supabase : la pile locale, par le proxy façon Kong ──
  VITE_SUPABASE_URL: LOCAL.proxyUrl,
  VITE_SUPABASE_ANON_KEY: signerJwt({ role: 'anon' }, an),
  SUPABASE_SERVICE_ROLE_KEY: signerJwt({ role: 'service_role' }, an),
  SUPABASE_DB_URL: LOCAL.dbUrl,
  SUPABASE_PROJECT_REF: 'lumefinal-local',
  // ── Serveur ──
  API_PORT: process.env.FINAL_API_PORT || '3491',
  FRONTEND_URL: `http://localhost:${process.env.FINAL_VITE_PORT || '5491'}`,
  AGENT_JWT_SECRET: 'lumefinal-agent-secret-jetable-0123456789abcdef',
  // 32 octets en base64 (server/lib/crypto.ts refuse tout autre format : l'API ne démarre pas).
  PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CRON_SECRET: 'lumefinal-cron-secret',
  NODE_ENV: 'development',
  // ── Lumi : le vrai modèle ──
  ANTHROPIC_API_KEY: reel.ANTHROPIC_API_KEY || '',
  ...(reel.LUMI_MODEL ? { LUMI_MODEL: reel.LUMI_MODEL } : {}),
  // ── Fournisseurs : volontairement VIDES ──
  STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', VITE_STRIPE_PUBLISHABLE_KEY: '',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', RESEND_API_KEY: '', COURRIEL_FOURNISSEUR: '',
  SES_SMTP_USER: '', SES_SMTP_PASS: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '',
  TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '',
  SLACK_BOT_TOKEN: '', SLACK_SIGNING_SECRET: '', GEMINI_API_KEY: '',
  QA_REDIRECT_TO: '', QA_REDIRECT_EMAIL: '', VITE_SENTRY_DSN: '', SENTRY_DSN: '',
};
writeFileSync(SORTIE, Object.entries(lignes).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`${SORTIE} écrit (${Object.keys(lignes).length} variables ; clé Anthropic ${lignes.ANTHROPIC_API_KEY ? 'présente' : 'ABSENTE'})`);
