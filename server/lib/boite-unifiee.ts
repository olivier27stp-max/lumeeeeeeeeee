/**
 * Boîte de réception unifiée — les conversations de tous les bureaux d'une
 * personne, dans une seule liste.
 *
 * Un bureau y entre seulement si la personne y a une adhésion ACTIVE, la
 * permission messages.read DANS CE BUREAU (page Rôles), et qu'il appartient à
 * la même entreprise que le bureau actif. Chaque bureau est ensuite lu avec
 * l'identité de la personne et l'en-tête de CE bureau (x-lume-org) : la RLS
 * et le filtre « bureau actif » s'appliquent comme dans la page Messages du
 * bureau. Aucune donnée métier n'est lue avec la clé de service.
 */
import { buildSupabaseWithAuth, getServiceClient } from './supabase';
import { getUserContext, hasPermission } from './rbac';

export interface MembreBoite { user_id: string; name: string }
export interface BureauBoite { org_id: string; name: string; members?: MembreBoite[] }

/** Pur : bureaux retenus — actifs, non supprimés, même entreprise que le bureau actif, triés du plus ancien. */
export function bureauxMemeEntreprise(
  orgActif: string,
  groupeActif: string | null,
  orgs: Array<{ id: string; name: string | null; created_at: string | null; deleted_at: string | null; archived_at?: string | null; company_group_id: string | null }>,
) {
  return orgs
    .filter((o) => !o.deleted_at && !o.archived_at && (o.id === orgActif || (groupeActif !== null && o.company_group_id === groupeActif)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export async function bureauxDeLaBoite(userId: string, orgActif: string): Promise<BureauBoite[]> {
  const admin = getServiceClient();
  const { data: actif, error: eActif } = await admin.from('orgs').select('company_group_id').eq('id', orgActif).maybeSingle();
  if (eActif) throw eActif;
  const { data: adhesions, error: eAdh } = await admin
    .from('memberships')
    .select('org_id, orgs!inner(id, name, created_at, deleted_at, archived_at, company_group_id)')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (eAdh) throw eAdh;
  const candidats = bureauxMemeEntreprise(orgActif, actif?.company_group_id ?? null, (adhesions || []).map((a: any) => a.orgs).filter(Boolean));

  const permis: typeof candidats = [];
  for (const o of candidats) {
    const ctx = await getUserContext(admin, userId, o.id);
    if (ctx && hasPermission(ctx, 'messages.read')) permis.push(o);
  }
  if (permis.length === 0) return [];
  const { data: reglages } = await admin.from('company_settings').select('org_id, company_name').in('org_id', permis.map((o) => o.id));
  const nom = new Map((reglages || []).filter((r: any) => r.company_name).map((r: any) => [String(r.org_id), String(r.company_name)]));
  const membres = await membresAssignables(permis.map((o) => o.id));
  return permis.map((o) => ({ org_id: o.id, name: nom.get(o.id) || String(o.name || ''), members: membres.get(o.id) || [] }));
}

/**
 * Personnes à qui l'on peut assigner une conversation, par bureau : adhésion
 * active ET messages.read dans ce bureau (sinon elles ne verraient pas la
 * conversation qu'on leur confie).
 */
export async function membresAssignables(orgIds: string[]): Promise<Map<string, MembreBoite[]>> {
  const admin = getServiceClient();
  const parBureau = new Map<string, MembreBoite[]>();
  if (!orgIds.length) return parBureau;
  const { data: adhesions, error } = await admin.from('memberships').select('user_id, org_id')
    .in('org_id', orgIds).eq('status', 'active');
  if (error) throw error;
  const ids = [...new Set((adhesions || []).map((a: any) => String(a.user_id)))];
  const { data: profils } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
  const nom = new Map((profils || []).map((p: any) => [String(p.id), String(p.full_name || '').trim()]));
  for (const a of adhesions || []) {
    const ctx = await getUserContext(admin, String(a.user_id), String(a.org_id));
    if (!ctx || !hasPermission(ctx, 'messages.read')) continue;
    const liste = parBureau.get(String(a.org_id)) || [];
    liste.push({ user_id: String(a.user_id), name: nom.get(String(a.user_id)) || '' });
    parBureau.set(String(a.org_id), liste);
  }
  for (const liste of parBureau.values()) liste.sort((x, y) => x.name.localeCompare(y.name));
  return parBureau;
}

/** Conversations de chaque bureau, lues avec l'identité de la personne, fusionnées du plus récent au plus ancien. */
export async function conversationsDesBureaux(authorization: string, bureaux: BureauBoite[]) {
  const listes = await Promise.all(bureaux.map(async (b) => {
    const { data, error } = await buildSupabaseWithAuth(authorization, b.org_id)
      .from('conversations')
      .select('*')
      .eq('org_id', b.org_id)
      .order('last_message_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []).map((c: { last_message_at: string | null } & Record<string, unknown>) => ({ ...c, office_name: b.name }));
  }));
  return listes.flat().sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
}
