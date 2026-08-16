/**
 * Dépose CRON_SECRET dans Vault, puis active la libération des numéros SMS.
 *
 * POURQUOI CE SCRIPT PLUTÔT QU'UNE MIGRATION
 * Le secret ne peut pas être écrit dans un fichier de migration : celui-ci est
 * versionné et partirait sur GitHub. Il ne peut pas non plus être passé en
 * argument de commande (il resterait dans l'historique du shell). Il est donc
 * lu depuis .env.local, qui est gitignoré — la même règle que le reste des
 * secrets du projet.
 *
 * USAGE
 *   node scripts/deposer-cron-secret.mjs            → staging
 *   node scripts/deposer-cron-secret.mjs --prod     → production
 *
 * PRÉREQUIS
 *   CRON_SECRET=<la valeur exacte configurée sur Railway> dans .env.local
 *
 * La valeur doit être IDENTIQUE à celle de Railway : la fonction Postgres
 * l'envoie dans l'en-tête `x-cron-secret`, et le serveur la compare à sa propre
 * variable d'environnement. Une valeur différente donne un 401 à chaque nuit,
 * échec aussi silencieux que l'absence de secret.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.argv.includes('--prod');

/** Lit une variable de .env.local sans passer par dotenv (pas d'expansion du $). */
function env(nom) {
  const txt = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const m = new RegExp(`^${nom}=(.*)$`, 'm').exec(txt);
  return m ? m[1].trim() : '';
}

const secret = env('CRON_SECRET');
if (!secret) {
  console.error('ERREUR : CRON_SECRET absent de .env.local.');
  console.error('Copiez-le depuis Railway (Variables du service) et ajoutez la ligne :');
  console.error('  CRON_SECRET=<la valeur exacte>');
  process.exit(2);
}

const REF_STAGING = env('SUPABASE_PROJECT_REF');
const REF_PROD = env('SUPABASE_PROJECT_REF_PROD');
const cible = PROD ? REF_PROD : REF_STAGING;

// La chaîne de .env.local pointe sur staging. Pour la prod, on remplace la
// référence dans l'utilisateur ET l'hôte : les deux projets sont dans des
// régions différentes (aws-1 pour la prod, aws-0 pour staging).
let brut = env('SUPABASE_DB_URL');
if (!brut) { console.error('ERREUR : SUPABASE_DB_URL absent de .env.local.'); process.exit(2); }
if (PROD) {
  brut = brut.replace(REF_STAGING, REF_PROD).replace('aws-0-', 'aws-1-');
}

// Découpage manuel : un mot de passe Supabase contient couramment @ : / $ que
// `new URL()` mal-parse, ce qui se manifeste par un trompeur
// « password authentication failed ».
const corps = brut.split('://')[1];
const at = corps.lastIndexOf('@');
const avant = corps.slice(0, at), hote = corps.slice(at + 1);
const sep = avant.indexOf(':');
const user = avant.slice(0, sep);
let mdp = avant.slice(sep + 1);
if (mdp.startsWith('[') && mdp.endsWith(']')) mdp = mdp.slice(1, -1);
const host = hote.slice(0, hote.indexOf(':'));
const reste = hote.slice(hote.indexOf(':') + 1);
const port = parseInt(reste.split('/')[0], 10);

console.log(`Cible : ${PROD ? 'PRODUCTION' : 'staging'} (${cible})`);

const c = new pg.Client({
  host, port, user, password: mdp, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
});

try {
  await c.connect();

  // Le secret passe en PARAMÈTRE, jamais concaténé : il n'apparaît donc ni dans
  // les journaux de requêtes de Postgres ni dans pg_stat_statements.
  const { rows: [avantEtat] } = await c.query(
    `select exists (select 1 from vault.decrypted_secrets where name='cron_secret') as present`,
  );

  if (avantEtat.present) {
    // create_secret échoue si le nom existe déjà : on met à jour.
    await c.query(
      `select vault.update_secret(
         (select id from vault.secrets where name='cron_secret'), $1)`,
      [secret],
    );
    console.log('  secret Vault mis à jour');
  } else {
    await c.query(`select vault.create_secret($1, 'cron_secret')`, [secret]);
    console.log('  secret Vault créé');
  }

  // Relecture : on vérifie que Vault rend bien la valeur attendue, sans jamais
  // l'afficher. Un secret déposé mais illisible serait pire que pas de secret.
  const { rows: [ok] } = await c.query(
    `select (select decrypted_secret from vault.decrypted_secrets where name='cron_secret') = $1 as concorde`,
    [secret],
  );
  if (!ok.concorde) {
    console.error('  ECHEC : la valeur relue ne correspond pas. Tâche laissée inactive.');
    process.exit(1);
  }
  console.log('  relecture Vault : conforme');

  const { rows: [job] } = await c.query(
    `select jobid from cron.job where jobname='lume_release_sms_numbers'`,
  );
  if (!job) {
    console.error('  tâche lume_release_sms_numbers absente — appliquer les migrations d\'abord.');
    process.exit(1);
  }

  await c.query(`select cron.alter_job($1, active := true)`, [job.jobid]);
  const { rows: [fin] } = await c.query(
    `select active from cron.job where jobname='lume_release_sms_numbers'`,
  );
  console.log(`  tâche lume_release_sms_numbers : active=${fin.active}`);
  console.log('Terminé.');
  await c.end();
} catch (e) {
  console.error('ECHEC :', e.message);
  process.exit(1);
}
