/**
 * Comptes propriétaires de test pour jouer la batterie en parallèle.
 * ─────────────────────────────────────────────────────────────────
 * La prod limite Lumi à 60 tours par heure ET PAR PERSONNE : une passe de 220
 * demandes sur un seul compte prend 3 à 4 heures. Avec quatre propriétaires de
 * test (celui du banc + trois créés ici), chacun joue un quart des cas : la
 * passe tient en une demi-heure, et aucun compte n'approche la limite.
 *
 * Par défaut le script n'écrit RIEN : il dit ce qu'il ferait (`--appliquer`
 * pour écrire). Il refuse un bureau dont le nom ne dit pas QA, TEST ou « banc »,
 * ou qui n'est pas au bac à sable des envois. Idempotent.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/comptes-baseline.mts [--appliquer]
 */
import { createClient } from '@supabase/supabase-js';

const ORG = process.env.EVAL_ORG || '93daa0c7-b749-4200-9755-dbeee62ce32d';
const APPLIQUER = process.argv.includes('--appliquer');
export const COMPTES_BASELINE = ['eval.proprio1@lume-qa.test', 'eval.proprio2@lume-qa.test', 'eval.proprio3@lume-qa.test'];

const url = process.env.SUPABASE_URL_PROD ?? '';
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
if (!url || !cle) throw new Error('SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis (.env.local).');
const admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: org, error: eOrg } = await admin.from('orgs').select('id, name').eq('id', ORG).maybeSingle();
if (eOrg || !org) throw new Error(`bureau introuvable : ${eOrg?.message ?? ORG}`);
if (!/qa|test|banc/i.test(String(org.name))) throw new Error(`Refus : « ${org.name} » n'est pas un bureau de test.`);
const { data: bac } = await admin.from('orgs_envois_simules').select('org_id').eq('org_id', ORG).maybeSingle();
if (!bac) throw new Error('Refus : le bureau n’est pas au bac à sable des envois.');

console.log(`Bureau : ${org.name}${APPLIQUER ? '' : '  (SIMULATION — rien n’est écrit)'}`);
for (let i = 0; i < COMPTES_BASELINE.length; i++) {
  const courriel = COMPTES_BASELINE[i];
  const nom = `[EVAL] Propriétaire ${i + 1}`;
  const { data: adhesion } = await admin.from('memberships').select('user_id, role, status').eq('org_id', ORG).eq('full_name', nom).maybeSingle();
  if (adhesion) { console.log(`  = ${courriel} : déjà là (${adhesion.role}, ${adhesion.status})`); continue; }
  if (!APPLIQUER) { console.log(`  + ${courriel} : à créer (propriétaire, « ${nom} »)`); continue; }
  const { data: u, error: eU } = await admin.auth.admin.createUser({ email: courriel, email_confirm: true, user_metadata: { full_name: nom } });
  if (eU || !u.user) throw new Error(`compte ${courriel} : ${eU?.message}`);
  const { error: eM } = await admin.from('memberships').insert({ user_id: u.user.id, org_id: ORG, role: 'owner', status: 'active', language: 'fr', full_name: nom });
  if (eM) throw new Error(`adhésion ${courriel} : ${eM.message}`);
  console.log(`  + ${courriel} : créé`);
}
