/**
 * Bureau de test de la suite `npm run test:automations` — STAGING seulement.
 *
 * Deux entreprises marquées « [TEST] » (A = celle qu'on éprouve, B = la
 * voisine qui ne doit JAMAIS rien voir ni subir de A), leurs comptes, un
 * forfait Autopilot, un numéro texto FICTIF (555-01xx) et des clients aux
 * coordonnées fictives (555-01xx, *.test).
 *
 * ORDRE DE SÛRETÉ : chaque entreprise est inscrite au bac à sable
 * (`orgs_envois_simules`) IMMÉDIATEMENT après sa création, avant qu'un seul
 * client, forfait ou numéro n'existe. Rien de ce qu'elle fera ne peut partir.
 *
 * Idempotent : relancé, il retrouve tout par les adresses des comptes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

export const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';

/**
 * `QA_AUTO_SUFFIXE` (facultatif) : un jeu de bureaux PAR développeur ou agent
 * qui écrit des tests en parallèle — chacun sa file planifiée, ses envois
 * simulés, sans se marcher dessus. La suite officielle tourne sans suffixe.
 */
const SUFFIXE = (process.env.QA_AUTO_SUFFIXE || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
const avecSuffixe = (email: string) => (SUFFIXE ? email.replace('@', `+${SUFFIXE}@`) : email);

export const COMPTES = {
  proprioA: { email: avecSuffixe('qa-auto-proprio-a@lume-qa.test'), nom: 'QA Proprio A', role: 'owner' as const },
  techA: { email: avecSuffixe('qa-auto-tech-a@lume-qa.test'), nom: 'QA Technicien A', role: 'technician' as const },
  proprioB: { email: avecSuffixe('qa-auto-proprio-b@lume-qa.test'), nom: 'QA Proprio B', role: 'owner' as const },
};

export const NOM_ORG_A = `[TEST] QA Automatisations A${SUFFIXE ? ` (${SUFFIXE})` : ''} — ne pas utiliser`;
export const NOM_ORG_B = `[TEST] QA Automatisations B${SUFFIXE ? ` (${SUFFIXE})` : ''} — ne pas utiliser`;
/**
 * Numéros texto FICTIFS (555-01xx), DISTINCTS par jeu de bureaux : un texto
 * entrant est routé vers l'entreprise par son numéro « To ». Quand tous les
 * jeux partageaient +15555550100, le texto d'un test arrivait chez le bureau
 * d'un autre agent (B-041 rouge dans la suite complète, vert seul).
 * Sans suffixe : 0100 / 0101. Avec suffixe : une paire dans 0102…0199.
 */
function numerosDuJeu(suffixe: string): [string, string] {
  if (!suffixe) return ['+15555550100', '+15555550101'];
  let h = 0;
  for (const c of suffixe) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const base = 102 + (h % 49) * 2;
  const n = (k: number) => `+155555501${String(k).padStart(2, '0').slice(-2)}`;
  return [n(base - 100), n(base - 99)];
}
export const [NUMERO_A, NUMERO_B] = numerosDuJeu(SUFFIXE);

export interface BureauTest {
  admin: SupabaseClient;
  orgA: string;
  orgB: string;
  users: Record<keyof typeof COMPTES, string>;
}

export function adminStaging(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !cle) throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (.env.local staging).');
  if (url.includes(REF_PROD)) throw new Error('REFUS : la suite des automatisations ne tourne JAMAIS sur la production.');
  return createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function assurerCompte(admin: SupabaseClient, email: string, nom: string): Promise<string> {
  // email_confirm : aucun courriel de confirmation n'est envoyé.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: nom },
  });
  if (data?.user) return data.user.id;
  // Compte déjà là : generateLink le retrouve sans rien envoyer (listUsers
  // échoue sur staging : « Database error finding users »).
  const { data: lien, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (lien?.user) return lien.user.id;
  throw new Error(`compte ${email} : ${error?.message} / ${e2?.message}`);
}

async function assurerOrg(admin: SupabaseClient, nom: string, createur: string): Promise<string> {
  const { data: existante } = await admin.from('orgs').select('id').eq('name', nom).is('deleted_at', null).maybeSingle();
  let orgId = existante?.id as string | undefined;
  if (!orgId) {
    const { data, error } = await admin.from('orgs').insert({ name: nom, created_by: createur, employee_count: '1-5' }).select('id').single();
    if (error) throw new Error(`org ${nom} : ${error.message}`);
    orgId = data.id as string;
  }
  // AVANT tout le reste : l'entreprise n'envoie plus rien.
  const { error } = await admin.from('orgs_envois_simules')
    .upsert({ org_id: orgId, mode: 'succes', raison: 'Bureau de test — npm run test:automations' }, { onConflict: 'org_id' });
  if (error) throw new Error(`bac à sable ${nom} : ${error.message} — ARRÊT : aucune donnée créée tant que l'entreprise n'est pas isolée.`);
  return orgId;
}

async function ok(p: PromiseLike<{ error: { message: string } | null }>, quoi: string) {
  const { error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
}

export async function assurerBureauTest(admin = adminStaging()): Promise<BureauTest> {
  const users = {
    proprioA: await assurerCompte(admin, COMPTES.proprioA.email, COMPTES.proprioA.nom),
    techA: await assurerCompte(admin, COMPTES.techA.email, COMPTES.techA.nom),
    proprioB: await assurerCompte(admin, COMPTES.proprioB.email, COMPTES.proprioB.nom),
  };
  const orgA = await assurerOrg(admin, NOM_ORG_A, users.proprioA);
  const orgB = await assurerOrg(admin, NOM_ORG_B, users.proprioB);

  const { data: plan } = await admin.from('plans').select('id').eq('slug', 'autopilot').single();
  for (const [org, numero, courriel] of [[orgA, NUMERO_A, 'bureau-a@lume-qa.test'], [orgB, NUMERO_B, 'bureau-b@lume-qa.test']] as const) {
    const proprio = org === orgA ? users.proprioA : users.proprioB;
    await ok(admin.from('memberships').upsert({ user_id: proprio, org_id: org, role: 'owner', status: 'active', full_name: org === orgA ? COMPTES.proprioA.nom : COMPTES.proprioB.nom }, { onConflict: 'user_id,org_id' }), 'membership proprio');
    const { data: cs } = await admin.from('company_settings').select('id').eq('org_id', org).maybeSingle();
    const reglages = {
      org_id: org, company_name: org === orgA ? 'Nettoyage Test A' : 'Nettoyage Test B', email: courriel, phone: numero,
      street1: '123 rue du Test', postal_code: 'H2X 1Y4', city: 'Montréal', province: 'QC', country: 'CA', timezone: 'America/Toronto', default_language: 'fr',
      industry: 'cleaning', currency: 'CAD', setup_completed: true, primary_color: '#0E7C66',
    };
    if (cs) await ok(admin.from('company_settings').update(reglages).eq('org_id', org), 'company_settings');
    else await ok(admin.from('company_settings').insert(reglages), 'company_settings');
    const { data: sub } = await admin.from('subscriptions').select('id').eq('org_id', org).in('status', ['active', 'trialing']).maybeSingle();
    if (!sub) {
      await ok(admin.from('subscriptions').insert({
        org_id: org, user_id: proprio, plan_id: plan!.id, status: 'active', interval: 'monthly', currency: 'CAD', amount_cents: 0,
        current_period_end: new Date(Date.now() + 365 * 86400_000).toISOString(),
      }), 'subscription');
    }
    const { data: canal } = await admin.from('communication_channels').select('id, phone_number').eq('org_id', org).eq('channel_type', 'sms').maybeSingle();
    if (canal && canal.phone_number !== numero) {
      // Un test a pu changer le numéro, ou le jeu date d'avant les numéros distincts.
      await ok(admin.from('communication_channels').update({ phone_number: numero }).eq('id', canal.id), 'numéro du bureau');
    }
    if (!canal) {
      await ok(admin.from('communication_channels').insert({
        org_id: org, channel_type: 'sms', provider: 'twilio', phone_number: numero, is_default: true, status: 'active',
        metadata: { fictif: true, note: 'Numéro 555-01xx fictif — bac à sable' },
      }), 'communication_channels');
    }
  }
  await ok(admin.from('memberships').upsert({ user_id: users.techA, org_id: orgA, role: 'technician', status: 'active', full_name: COMPTES.techA.nom }, { onConflict: 'user_id,org_id' }), 'membership tech');

  return { admin, orgA, orgB, users };
}

/** Une session réelle (JWT) pour un compte de test : les routes et la RLS s'appliquent. */
export async function sessionDe(admin: SupabaseClient, email: string): Promise<{ jeton: string; client: SupabaseClient }> {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const { data: s, error: e2 } = await createClient(url, anon, opts).auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  const jeton = s.session.access_token;
  return { jeton, client: createClient(url, anon, { ...opts, global: { headers: { Authorization: `Bearer ${jeton}` } } }) };
}
