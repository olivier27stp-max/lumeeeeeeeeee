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
  cacheDelete(CLE_CACHE_CONTACTS);
}

/** « Activer le compte » : les communications repartent. */
export async function activerCommunications(admin: SupabaseClient, orgId: string, activePar: string): Promise<void> {
  const actuel = await etatGel(admin, orgId);
  const { error } = await admin
    .from('org_features')
    .upsert({ org_id: orgId, feature: FEATURE_GEL, enabled: false, metadata: { migration_id: actuel.migration_id, gele_le: actuel.gele_le, active_le: new Date().toISOString(), active_par: activePar }, updated_at: new Date().toISOString() }, { onConflict: 'org_id,feature' });
  if (error) throw error;
  cacheDelete(CLE_CACHE);
  cacheDelete(CLE_CACHE_CONTACTS);
}

export interface Destinataire { email?: string | null; phone?: string | null }

interface ContactsOrg { emails: Set<string>; phones: Set<string> }
const CLE_CACHE_CONTACTS = 'gel-communications:contacts';

/** Derniers 10 chiffres de chaque numéro d'une cellule (« +1 (514) 555-1234 », « 514…;438… »). */
function clesTelephone(brut: string | null | undefined): string[] {
  return String(brut ?? '')
    .split(/[;,/|]+/)
    .map((x) => normalizeDigits(x).slice(-10))
    .filter((d) => d.length >= 7);
}

/**
 * Contacts (courriels et téléphones normalisés) des clients de chaque bureau gelé, en mémoire
 * 20 s. Comparer en base avec `ilike '%5551234'` ratait un numéro stocké « (514) 555-1234 »
 * ou « 514-555-1234 » — un tiers des fiches de Vision Lavage (2026-09-25) : la garde laissait
 * passer les SMS automatisés vers ces clients pendant le gel. Ici, tout est normalisé des
 * deux côtés (chiffres seuls, courriel en minuscules), y compris les numéros secondaires.
 */
async function contactsGeles(admin: SupabaseClient, gelees: Set<string>): Promise<Map<string, ContactsOrg>> {
  return cached(CLE_CACHE_CONTACTS, TTL_S, async () => {
    const index = new Map<string, ContactsOrg>();
    for (const org of gelees) index.set(org, { emails: new Set(), phones: new Set() });
    const orgs = Array.from(gelees);
    const PAGE = 1000;
    for (let from = 0; from < 50000; from += PAGE) {
      type Ligne = { org_id: string; email: string | null; phone: string | null; phones?: unknown };
      let res: { data: Ligne[] | null; error: { message: string } | null } = await admin.from('clients').select('org_id, email, phone, phones').in('org_id', orgs).is('deleted_at', null).range(from, from + PAGE - 1);
      // Colonne `phones` (numéros secondaires) absente sur certains déploiements : on retombe sur `phone` seul.
      if (res.error) res = await admin.from('clients').select('org_id, email, phone').in('org_id', orgs).is('deleted_at', null).range(from, from + PAGE - 1);
      if (res.error) { console.error('[gel-communications] lecture des contacts impossible :', res.error.message); break; }
      const rows: Ligne[] = res.data ?? [];
      for (const c of rows) {
        const cible = index.get(c.org_id);
        if (!cible) continue;
        const email = (c.email ?? '').trim().toLowerCase();
        if (email) cible.emails.add(email);
        for (const k of clesTelephone(c.phone)) cible.phones.add(k);
        const secondaires = Array.isArray(c.phones) ? c.phones : [];
        for (const p of secondaires) {
          const valeur = typeof p === 'string' ? p : (p && typeof p === 'object' && 'number' in p ? String((p as { number?: unknown }).number ?? '') : '');
          for (const k of clesTelephone(valeur)) cible.phones.add(k);
        }
      }
      if (rows.length < PAGE) break;
    }
    return index;
  });
}

/**
 * Le destinataire est-il un client d'un bureau gelé ? Renvoie l'org gelée, sinon null.
 * Coût nul tant qu'aucun bureau n'est gelé (cas normal) ; sinon une lecture des contacts
 * du bureau gelé, mise en cache 20 s.
 */
export async function destinataireGele(admin: SupabaseClient, d: Destinataire, orgIdConnu?: string | null): Promise<string | null> {
  const gelees = await orgsGelees(admin);
  if (gelees.size === 0) return null;
  // Un bureau connu et NON gelé : jamais vérifié plus loin (le personnel, un autre bureau).
  if (orgIdConnu && !gelees.has(orgIdConnu)) return null;
  const email = (d.email ?? '').trim().toLowerCase();
  const telephones = clesTelephone(d.phone);
  if (!email && telephones.length === 0) return null;
  const index = await contactsGeles(admin, gelees);
  const cibles = orgIdConnu ? [orgIdConnu] : Array.from(gelees);
  for (const org of cibles) {
    const contacts = index.get(org);
    if (!contacts) continue;
    if (email && contacts.emails.has(email)) return org;
    if (telephones.some((t) => contacts.phones.has(t))) return org;
  }
  return null;
}

export const MESSAGE_GEL = 'Communications gelées : les données viennent d’être importées et le compte n’est pas encore activé. Cliquez « Activer le compte » dans la console des migrations.';

/** Journalise un envoi bloqué (une trace par blocage, jamais de courriel ou SMS émis). */
export function journaliserBlocage(canal: 'courriel' | 'sms', orgId: string, cible: string, contexte?: string): void {
  console.warn(`[gel-communications] ${canal} bloqué vers ${cible.replace(/(.{3}).+(@|\d{2}$)/, '$1…$2')} (org ${orgId}${contexte ? `, ${contexte}` : ''})`);
}
