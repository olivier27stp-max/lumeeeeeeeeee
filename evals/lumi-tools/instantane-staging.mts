/**
 * Instantané LECTURE SEULE des données de l'org QA sur staging, pour écrire
 * des cas d'évaluation qui visent des fiches qui existent (noms, numéros).
 * Refuse la prod.
 *
 *   node --env-file=.env.local --import tsx evals/lumi-tools/instantane-staging.mts [--sortie evals/lumi-tools/donnees-staging.json]
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

// Même résolution que les batteries : le lien magique renvoie l'utilisateur (rien n'est envoyé).
const { data: lien, error: errLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
if (errLien) throw new Error(`compte QA : ${errLien.message}`);
const userId = lien.user?.id;
if (!userId) throw new Error('compte QA introuvable');
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
const org = (m as any)?.org_id as string;

const lire = async (table: string, colonnes: string, limite = 40, filtre?: (q: any) => any) => {
  let q = admin.from(table).select(colonnes).eq('org_id', org).limit(limite);
  if (filtre) q = filtre(q);
  const { data, error } = await q;
  return error ? { erreur: error.message } : data;
};
const sansSupprimes = (q: any) => q.is('deleted_at', null);

const donnees = {
  org,
  clients: await lire('clients', 'first_name, last_name, company, city, status, email, phone', 60, sansSupprimes),
  factures: await lire('invoices', 'invoice_number, status, total_cents, balance_cents, due_date, client_name_snapshot', 40, sansSupprimes),
  devis: await lire('quotes', 'quote_number, title, status, total_cents', 40, sansSupprimes),
  jobs: await lire('jobs', 'job_number, title, client_name, status, scheduled_at', 40, sansSupprimes),
  equipe: await lire('team_members', 'first_name, last_name, role, email', 30),
  equipes: await lire('teams', 'name', 20),
  taches: await lire('tasks', 'title, status, due_date', 30, sansSupprimes),
  deals: await lire('pipeline_deals', 'title, stage', 30, sansSupprimes),
  factures_recurrentes: await lire('recurring_invoices', 'title, frequency, is_active', 20),
  automatisations: await lire('automation_rules', 'name, trigger_event, is_active', 40),
  rapports_planifies: await lire('scheduled_reports', 'frequency, recipient_email, enabled', 10),
  prereglages_devis: await lire('quote_presets', 'name', 20),
  modeles_devis: await lire('quote_templates', 'name', 20),
  modeles_courriel: await lire('email_templates', 'name, type', 20),
  services: await lire('predefined_services', 'name, default_price_cents', 30),
  territoires: await lire('d2d_territories', 'name', 20),
  formations: await lire('courses', 'title, status', 20),
};
writeFileSync(arg('--sortie', 'evals/lumi-tools/donnees-staging.json'), JSON.stringify(donnees, null, 1));
console.log(Object.fromEntries(Object.entries(donnees).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])));
process.exit(0);
