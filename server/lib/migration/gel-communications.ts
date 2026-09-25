// Gel des communications après un import de données.
//
// Dès qu'un import final démarre, le bureau passe en « communications gelées » : aucun courriel,
// aucun SMS, aucune automatisation ne part vers un client de ce bureau tant que l'admin n'a pas
// cliqué « Activer le compte » dans la console. La garde est appliquée AU DESTINATAIRE, dans
// les fonctions d'envoi elles-mêmes (mailer, SMS, automatisations, agent) : un client importé
// hier ne reçoit pas par erreur une relance, un rappel de visite ou une demande d'avis avant
// que tout soit vérifié. Le personnel (invitations d'équipe, MFA) n'est jamais concerné : la
// garde ne bloque que les adresses et numéros qui appartiennent à un CLIENT du bureau gelé.
//
// Stockage : org_features (feature = 'communications_gelees', enabled = true pendant le gel),
// metadata { migration_id, gele_le, active_le, active_par }. Aucune colonne ajoutée.

import type { SupabaseClient } from '@supabase/supabase-js';
import { cached, cacheDelete } from '../cache';
import { normalizeDigits } from './normalize';

export const FEATURE_GEL = 'communications_gelees';
const CLE_CACHE = 'gel-communications:orgs';
const TTL_S = 20;

export interface EtatGel {
  gele: boolean;
  migration_id: string | null;
  gele_le: string | null;
  active_le: string | null;
  active_par: string | null;
}

/** Bureaux actuellement gelés (mis en cache 20 s : la garde est appelée à chaque envoi). */
export async function orgsGelees(admin: SupabaseClient): Promise<Set<string>> {
  return cached(CLE_CACHE, TTL_S, async () => {
    const { data, error } = await admin.from('org_features').select('org_id').eq('feature', FEATURE_GEL).eq('enabled', true);
    if (error) { console.error('[gel-communications] lecture impossible :', error.message); return new Set<string>(); }
    return new Set((data ?? []).map((r: { org_id: string }) => r.org_id));
  });
}

export async function etatGel(admin: SupabaseClient, orgId: string): Promise<EtatGel> {
  const { data } = await admin.from('org_features').select('enabled, metadata').eq('org_id', orgId).eq('feature', FEATURE_GEL).maybeSingle();
  const meta = (data?.metadata ?? {}) as Partial<EtatGel>;
  return { gele: !!data?.enabled, migration_id: meta.migration_id ?? null, gele_le: meta.gele_le ?? null, active_le: meta.active_le ?? null, active_par: meta.active_par ?? null };
}

/** Au démarrage d'un import final : le bureau est gelé jusqu'à « Activer le compte ». */
export async function gelerCommunications(admin: SupabaseClient, orgId: string, migrationId: string): Promise<void> {
  const { error } = await admin
    .from('org_features')
    .upsert({ org_id: orgId, feature: FEATURE_GEL, enabled: true, metadata: { migration_id: migrationId, gele_le: new Date().toISOString(), active_le: null, active_par: null }, updated_at: new Date().toISOString() }, { onConflict: 'org_id,feature' });
  if (error) console.error('[gel-communications] gel impossible :', error.message);
  cacheDelete(CLE_CACHE);
}

/** « Activer le compte » : les communications repartent. */
export async function activerCommunications(admin: SupabaseClient, orgId: string, activePar: string): Promise<void> {
  const actuel = await etatGel(admin, orgId);
  const { error } = await admin
    .from('org_features')
    .upsert({ org_id: orgId, feature: FEATURE_GEL, enabled: false, metadata: { migration_id: actuel.migration_id, gele_le: actuel.gele_le, active_le: new Date().toISOString(), active_par: activePar }, updated_at: new Date().toISOString() }, { onConflict: 'org_id,feature' });
  if (error) throw error;
  cacheDelete(CLE_CACHE);
}

export interface Destinataire { email?: string | null; phone?: string | null }

/**
 * Le destinataire est-il un client d'un bureau gelé ? Renvoie l'org gelée, sinon null.
 * Coût nul tant qu'aucun bureau n'est gelé (cas normal) ; sinon une requête légère sur clients.
 */
export async function destinataireGele(admin: SupabaseClient, d: Destinataire, orgIdConnu?: string | null): Promise<string | null> {
  const gelees = await orgsGelees(admin);
  if (gelees.size === 0) return null;
  const email = (d.email ?? '').trim().toLowerCase();
  const digits = normalizeDigits(d.phone ?? '').slice(-10);
  if (!email && digits.length < 7) return null;
  // Un bureau connu et gelé : on vérifie que le destinataire est bien un de ses clients (pas le personnel).
  const cibles = orgIdConnu && gelees.has(orgIdConnu) ? [orgIdConnu] : Array.from(gelees);
  if (orgIdConnu && !gelees.has(orgIdConnu)) return null;
  let q = admin.from('clients').select('org_id, email, phone').in('org_id', cibles).is('deleted_at', null).limit(20);
  q = email && digits.length >= 7 ? q.or(`email.ilike.${email},phone.ilike.%${digits.slice(-7)}`) : email ? q.ilike('email', email) : q.ilike('phone', `%${digits.slice(-7)}`);
  const { data, error } = await q;
  if (error) { console.error('[gel-communications] vérification impossible :', error.message); return null; }
  for (const c of (data ?? []) as Array<{ org_id: string; email: string | null; phone: string | null }>) {
    const okEmail = email && (c.email ?? '').trim().toLowerCase() === email;
    const okPhone = digits.length >= 7 && normalizeDigits(c.phone ?? '').slice(-10) === digits;
    if (okEmail || okPhone) return c.org_id;
  }
  return null;
}

export const MESSAGE_GEL = 'Communications gelées : les données viennent d’être importées et le compte n’est pas encore activé. Cliquez « Activer le compte » dans la console des migrations.';

/** Journalise un envoi bloqué (une trace par blocage, jamais de courriel ou SMS émis). */
export function journaliserBlocage(canal: 'courriel' | 'sms', orgId: string, cible: string, contexte?: string): void {
  console.warn(`[gel-communications] ${canal} bloqué vers ${cible.replace(/(.{3}).+(@|\d{2}$)/, '$1…$2')} (org ${orgId}${contexte ? `, ${contexte}` : ''})`);
}
