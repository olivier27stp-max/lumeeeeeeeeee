/**
 * Préparation des tests d'INTÉGRATION de la suite des automatisations.
 * Chargé avant tout module (setupFiles) : les fournisseurs sont neutralisés
 * AVANT que mailer.ts ou config.ts ne lisent l'environnement.
 *
 * Trois ceintures, indépendantes du bac à sable qu'elles encadrent :
 *  1. Courriel : SMTP forcé vers 127.0.0.1:9 (port fermé), Resend et SES
 *     retirés. Un courriel qui échapperait au bac à sable échoue en
 *     ECONNREFUSED — il ne peut pas partir.
 *  2. Texto : aucune variable Twilio → pas de client réel. Le moteur reçoit
 *     un client PIÈGE (harnais/moteur.ts) qui compte et refuse chaque appel.
 *  3. HTTP : `fetch` n'accepte que Supabase (staging), l'API de gestion et
 *     Anthropic (tests Lumi). Toute autre adresse est comptée et refusée.
 *
 * Le test canari (integration/00-canari.test.ts) prouve que ces pièges
 * DÉTECTENT un envoi réel (témoin positif) et qu'aucun envoi du bureau de
 * test ne les atteint.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true } as never);
// Valeurs VIDES, jamais `delete` : server/lib/config.ts relit .env.local au
// chargement, et dotenv remet toute variable absente — le canari l'a montré
// (la redirection QA supprimée était revenue).

const url = process.env.VITE_SUPABASE_URL ?? '';
if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) {
  throw new Error('REFUS : tests d’intégration des automatisations = STAGING seulement (VITE_SUPABASE_URL).');
}

// Le bac à sable lit sa liste en base (désactivé par défaut sous vitest).
process.env.BAC_A_SABLE_EN_TEST = '1';

// 1. Courriel
process.env.COURRIEL_FOURNISSEUR = 'smtp';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '9';
process.env.SMTP_USER = 'piege@lume-qa.test';
process.env.SMTP_PASS = 'piege';
process.env.RESEND_API_KEY = '';
process.env.SES_SMTP_USER = '';
process.env.SES_SMTP_PASS = '';
// Une redirection QA masquerait un envoi réel sous une vraie boîte : retirée.
process.env.QA_REDIRECT_TO = '';
process.env.QA_REDIRECT_EMAIL = '';
// 2. Texto
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_PHONE_NUMBER = '';
// Slack du support : jamais depuis les tests.
process.env.SLACK_BOT_TOKEN = '';
// Liens publics plausibles dans les gabarits.
process.env.PUBLIC_URL ||= 'https://staging.lume-qa.test';

// 3. HTTP
const hotesPermis = new Set<string>([
  new URL(url).host,
  'api.supabase.com',
  'api.anthropic.com',
]);
if (process.env.LUME_API_TEST) hotesPermis.add(new URL(process.env.LUME_API_TEST).host);

export interface AppelBloque { url: string; quand: string }
const bloques: AppelBloque[] = [];
(globalThis as { __appelsBloques?: AppelBloque[] }).__appelsBloques = bloques;

const fetchOrigine = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
  const cible = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  let hote = '';
  try { hote = new URL(cible).host; } catch { /* adresse relative : refusée plus bas */ }
  if (!hotesPermis.has(hote) && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hote)) {
    bloques.push({ url: cible, quand: new Date().toISOString() });
    throw new Error(`PIÈGE : appel HTTP sortant refusé en test (${hote || cible})`);
  }
  return fetchOrigine(entree as RequestInfo, init);
}) as typeof fetch;
