/**
 * Comptes supplémentaires du lot « rôles » — rien du produit n'est modifié.
 *
 * Le banc fournit propriétaire, admin, technicien (bureau A) et le propriétaire
 * du bureau B. La matrice des rôles de la carte (§5.2) en demande trois de plus,
 * tous dans le bureau A :
 *   · `vendeurA`  : rôle `sales_rep`, aucune surcharge (ni `automations.read` ni `.update`) ;
 *   · `lecteurA`  : rôle `sales_rep` + surcharge `automations.read` seul ;
 *   · `editeurA`  : rôle `sales_rep` + surcharges `automations.read` et `.update` (non admin).
 * Les surcharges vivent dans `memberships.permissions` (jsonb { clé: booléen }) :
 * c'est là que la page Rôles les range, et c'est ce que lisent `hasPermission`
 * (serveur, server/lib/rbac.ts), `resolvePermissions` (navigateur) et
 * `member_has_permission` (base).
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

export type ComptePerso = 'vendeurA' | 'lecteurA' | 'editeurA';
export type CompteBanc = 'proprioA' | 'adminA' | 'techA' | 'proprioB';
export type Role = CompteBanc | ComptePerso;

export const ROLES_A: readonly Role[] = ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA', 'techA'];
export const TOUS_LES_ROLES: readonly Role[] = [...ROLES_A, 'proprioB'];

export const LIBELLE: Record<Role, string> = {
  proprioA: 'propriétaire',
  adminA: 'admin',
  editeurA: 'membre read+update (non admin)',
  lecteurA: 'membre read seul',
  vendeurA: 'vendeur',
  techA: 'technicien',
  proprioB: 'propriétaire d’un AUTRE bureau',
};

/**
 * Deux comptes de plus, HORS de la matrice des rôles (`Role`, `ROLES_A` ne changent pas) : ils servent aux seuls
 * tests de Réglages › Messagerie SMS. La section « Textos automatiques » ne s'affiche que si le numéro du bureau
 * a pu être lu, et `GET /api/communications/channels` exige `integrations.read` (server/lib/route-permissions.ts) :
 * sans cette surcharge, ni le vendeur ni le membre en lecture seule ne voient la section (constaté sur la pile
 * locale le 2026-10-01 — l'écran affiche « Permission denied: integrations.read »).
 *   · `lecteurSmsA` : `automations.read` + `integrations.read` — il voit les interrupteurs sans pouvoir publier ;
 *   · `vendeurSmsA` : `integrations.read` seul — il voit la section sans pouvoir lire les automatisations.
 */
export type CompteMessagerie = 'lecteurSmsA' | 'vendeurSmsA';

const DEFINITIONS: Record<ComptePerso | CompteMessagerie, { fragment: string; nom: string; permissions: Record<string, boolean> | null }> = {
  vendeurA: { fragment: 'vendeur-a', nom: 'QA Vendeur A', permissions: null },
  lecteurA: { fragment: 'lecteur-a', nom: 'QA Lecteur A', permissions: { 'automations.read': true } },
  editeurA: { fragment: 'editeur-a', nom: 'QA Editeur A', permissions: { 'automations.read': true, 'automations.update': true } },
  lecteurSmsA: { fragment: 'lecteur-sms-a', nom: 'QA Lecteur SMS A', permissions: { 'automations.read': true, 'integrations.read': true } },
  vendeurSmsA: { fragment: 'vendeur-sms-a', nom: 'QA Vendeur SMS A', permissions: { 'integrations.read': true } },
};

export type ComptesPerso = Record<ComptePerso | CompteMessagerie, { email: string; id: string }>;

/** Crée (ou retrouve) les cinq comptes, dans le bureau A seulement. Idempotent. */
export async function assurerComptesPerso(admin: SupabaseClient, orgA: string, emailProprioA: string): Promise<ComptesPerso> {
  const sortie = {} as ComptesPerso;
  // Déjà en place ? Une seule lecture suffit alors (le worker redémarre après chaque test rouge).
  const { data: deja } = await admin.from('memberships').select('user_id, full_name, role, status, permissions').eq('org_id', orgA).in('full_name', Object.values(DEFINITIONS).map((d) => d.nom));
  for (const cle of Object.keys(DEFINITIONS) as Array<ComptePerso | CompteMessagerie>) {
    const def = DEFINITIONS[cle];
    const email = emailProprioA.replace('proprio-a', def.fragment);
    if (!/@lume-qa\.test$/.test(email) || email === emailProprioA) throw new Error(`REFUS : adresse de test inattendue (${email}).`);
    const m = (deja ?? []).find((x) => x.full_name === def.nom);
    if (m && m.role === 'sales_rep' && m.status === 'active' && JSON.stringify(m.permissions ?? null) === JSON.stringify(def.permissions)) {
      sortie[cle] = { email, id: m.user_id as string };
      continue;
    }
    const cree = await admin.auth.admin.createUser({
      email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: def.nom },
    });
    let id = cree.data?.user?.id;
    if (!id) {
      const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (!lien?.user) throw new Error(`compte ${email} : ${cree.error?.message} / ${error?.message}`);
      id = lien.user.id;
    }
    const { error: eM } = await admin.from('memberships').upsert(
      { user_id: id, org_id: orgA, role: 'sales_rep', status: 'active', full_name: def.nom, permissions: def.permissions },
      { onConflict: 'user_id,org_id' },
    );
    if (eM) throw new Error(`adhésion ${email} : ${eM.message}`);
    await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
    sortie[cle] = { email, id };
  }
  return sortie;
}

/** Session neuve par lien magique (aucun courriel ne part : le lien est consommé ici). */
export async function sessionParEmail(admin: SupabaseClient, email: string): Promise<Session> {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique ${email} : ${error.message}`);
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

/** Client supabase-js agissant COMME le porteur du jeton (RLS active) — pour les scripts hors Playwright. */
export function clientAvecJeton(jeton: string): SupabaseClient {
  return createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jeton}` } },
  });
}
