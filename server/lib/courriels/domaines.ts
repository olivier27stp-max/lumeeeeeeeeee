/**
 * Domaine d'envoi propre à une entreprise (2026-09-17) — « chaque entreprise
 * envoie depuis son propre domaine », comme Salesforce.
 *
 * Client de l'API Resend Domains (https://resend.com/docs/api-reference/domains)
 * en `fetch` nu, jamais le SDK :
 *   POST   /domains              { name, region }  → { id, name, status, records[] }
 *   GET    /domains/:id                            → { id, name, status, records[] }
 *   POST   /domains/:id/verify                     → { object, id }  (pas d'enregistrements)
 *   DELETE /domains/:id                            → { object, id, deleted }
 *
 * Statuts Resend d'un domaine : not_started, pending, verified,
 * partially_verified, partially_failed, failed, temporary_failure. On les
 * ramène à trois : pending / verified / failed (colonne CHECK en base).
 *
 * La table `org_sending_domains` est écrite ici seulement (service_role) ;
 * `expediteurDe` est ce que `senderForOrg` (routes/emails.ts) consulte avant
 * chaque envoi, derrière un cache mémoire de 5 min par org.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

const RESEND_API = 'https://api.resend.com';
const TABLE = 'org_sending_domains';
export const PARTIE_LOCALE_DEFAUT = 'facturation';
/** Domaines de la plateforme : jamais délégués à une entreprise. */
const DOMAINES_RESERVES = ['lumecrm.net', 'lumecrm.com', 'lume.crm'];

export type StatutDomaine = 'pending' | 'verified' | 'failed';

export interface EnregistrementDns {
  /** SPF / DKIM / Tracking… tel que Resend le nomme. */
  record: string | null;
  type: string;
  name: string;
  value: string;
  ttl: string | null;
  status: string | null;
  priority: number | null;
}

export interface DomaineEnvoi {
  id: string;
  org_id: string;
  domain: string;
  resend_domain_id: string | null;
  from_local_part: string;
  status: StatutDomaine;
  dns_records: EnregistrementDns[];
  last_checked_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DomaineResend {
  id: string;
  name?: string;
  status?: string;
  records?: unknown;
}

function erreurHttp(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

// ── Validation et construction pures (testées sans réseau) ──

/**
 * Normalise et valide un domaine saisi par l'entreprise : minuscules, sans
 * schéma ni chemin, ASCII strict (lettres, chiffres, tirets, points), au
 * moins un point, TLD alphabétique. Refuse les domaines de la plateforme et
 * leurs sous-domaines. Lève une erreur 400 sinon.
 */
export function validerDomaine(saisie: unknown): string {
  const brut = String(saisie ?? '').trim().toLowerCase();
  const sansSchema = brut.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (!sansSchema) throw erreurHttp('Domain is required.', 400);
  if (sansSchema.length > 253) throw erreurHttp('Domain is too long.', 400);
  const etiquettes = sansSchema.split('.');
  const etiquetteValide = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (etiquettes.length < 2 || !etiquettes.every((e) => etiquetteValide.test(e))) {
    throw erreurHttp('Invalid domain. Expected something like example.com.', 400);
  }
  const tld = etiquettes[etiquettes.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld)) throw erreurHttp('Invalid domain. Expected something like example.com.', 400);
  for (const reserve of DOMAINES_RESERVES) {
    if (sansSchema === reserve || sansSchema.endsWith(`.${reserve}`)) {
      throw erreurHttp('This domain belongs to the platform and cannot be used.', 400);
    }
  }
  return sansSchema;
}

/** Ramène le statut Resend aux trois statuts de la table. */
export function statutDepuisResend(statut: unknown): StatutDomaine {
  switch (String(statut ?? '').toLowerCase()) {
    case 'verified':
      return 'verified';
    case 'failed':
    case 'temporary_failure':
    case 'partially_failed':
      return 'failed';
    default:
      // not_started, pending, partially_verified, inconnu…
      return 'pending';
  }
}

/** Les enregistrements DNS de la réponse Resend, au format stocké (tolérant à un champ manquant). */
export function enregistrementsDepuisResend(records: unknown): EnregistrementDns[] {
  if (!Array.isArray(records)) return [];
  const out: EnregistrementDns[] = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const type = String(o.type ?? '').toUpperCase();
    const name = String(o.name ?? '');
    const value = String(o.value ?? '');
    if (!type || !name || !value) continue;
    out.push({
      record: o.record != null ? String(o.record) : null,
      type,
      name,
      value,
      ttl: o.ttl != null ? String(o.ttl) : null,
      status: o.status != null ? String(o.status) : null,
      priority: typeof o.priority === 'number' ? o.priority : null,
    });
  }
  return out;
}

/** « {Entreprise} <facturation@domaine.ca> » — le nom est nettoyé des caractères qui casseraient l'en-tête. */
export function construireExpediteur(nom: string | null | undefined, partieLocale: string, domaine: string): string {
  const affiche = String(nom || 'Lume').replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim() || 'Lume';
  const locale = (partieLocale || PARTIE_LOCALE_DEFAUT).toLowerCase();
  return `${affiche} <${locale}@${domaine}>`;
}

// ── Client Resend ──

async function resend<T>(method: 'GET' | 'POST' | 'DELETE', chemin: string, corps?: Record<string, unknown>): Promise<T> {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) throw erreurHttp('Email provider is not configured.', 503);
  const res = await fetch(`${RESEND_API}${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.warn('[domaines] Resend a refusé', { method, chemin, status: res.status, message: json?.message || json?.name });
    // 404 chez Resend (domaine déjà retiré à la main) : l'appelant décide.
    throw erreurHttp(`Resend ${res.status}: ${json?.message || json?.name || 'unknown error'}`, res.status === 404 ? 404 : 502);
  }
  return json as T;
}

// ── Cache mémoire (5 min par org) du domaine vérifié ──

const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheVerifie = new Map<string, { expire: number; valeur: { domain: string; from_local_part: string } | null }>();

/** À appeler après toute écriture : l'expéditeur suivant relit la base. */
export function oublierCacheDomaine(orgId: string): void {
  cacheVerifie.delete(orgId);
}

// ── Lecture ──

export async function lireDomaine(admin: SupabaseClient, orgId: string): Promise<DomaineEnvoi | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select('id, org_id, domain, resend_domain_id, from_local_part, status, dns_records, last_checked_at, verified_at, created_at, updated_at')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...(data as DomaineEnvoi), dns_records: enregistrementsDepuisResend((data as DomaineEnvoi).dns_records) };
}

/**
 * Le domaine vérifié de l'org (ou null), derrière le cache. Une erreur de
 * lecture (table absente sur un environnement pas encore migré) vaut null :
 * on retombe sur l'expéditeur de la plateforme, jamais sur un échec d'envoi.
 */
async function domaineVerifieDe(admin: SupabaseClient, orgId: string): Promise<{ domain: string; from_local_part: string } | null> {
  const maintenant = Date.now();
  const enCache = cacheVerifie.get(orgId);
  if (enCache && enCache.expire > maintenant) return enCache.valeur;
  let valeur: { domain: string; from_local_part: string } | null = null;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select('domain, from_local_part')
      .eq('org_id', orgId)
      .eq('status', 'verified')
      .maybeSingle();
    if (error) {
      logger.warn('[domaines] lecture du domaine vérifié échouée, expéditeur plateforme', { orgId, error: error.message });
    } else if (data?.domain) {
      valeur = { domain: String(data.domain), from_local_part: String(data.from_local_part || PARTIE_LOCALE_DEFAUT) };
    }
  } catch (err: any) {
    logger.warn('[domaines] lecture du domaine vérifié échouée, expéditeur plateforme', { orgId, error: err?.message || String(err) });
  }
  cacheVerifie.set(orgId, { expire: maintenant + CACHE_TTL_MS, valeur });
  return valeur;
}

/**
 * L'expéditeur propre à l'org : `{ from, replyTo }` si son domaine est
 * vérifié, null sinon (l'appelant garde alors l'expéditeur de la plateforme).
 * `company` évite une seconde lecture de company_settings quand l'appelant
 * l'a déjà ; sinon on la lit ici.
 */
export async function expediteurDe(
  admin: SupabaseClient,
  orgId: string,
  company?: { company_name?: string | null; company_email?: string | null },
): Promise<{ from: string; replyTo?: string } | null> {
  const verifie = await domaineVerifieDe(admin, orgId);
  if (!verifie) return null;
  let nom = company?.company_name ?? null;
  let replyTo = company?.company_email ?? null;
  if (!company) {
    const { data } = await admin.from('company_settings').select('company_name, email').eq('org_id', orgId).limit(1).maybeSingle();
    nom = data?.company_name ?? null;
    replyTo = data?.email ?? null;
  }
  return {
    from: construireExpediteur(nom, verifie.from_local_part, verifie.domain),
    replyTo: replyTo || undefined,
  };
}

// ── Écritures (routes owner/admin) ──

/** Déclare le domaine chez Resend et l'enregistre en attente, avec les enregistrements DNS à coller. */
export async function demanderDomaine(admin: SupabaseClient, orgId: string, domaineSaisi: unknown): Promise<DomaineEnvoi> {
  const domain = validerDomaine(domaineSaisi);
  const existant = await lireDomaine(admin, orgId);
  if (existant) throw erreurHttp('A sending domain is already configured. Remove it first.', 409);

  const cree = await resend<DomaineResend>('POST', '/domains', { name: domain, region: 'us-east-1' });
  if (!cree?.id) throw erreurHttp('Resend did not return a domain id.', 502);

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      org_id: orgId,
      domain,
      resend_domain_id: cree.id,
      from_local_part: PARTIE_LOCALE_DEFAUT,
      status: statutDepuisResend(cree.status),
      dns_records: enregistrementsDepuisResend(cree.records),
      last_checked_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    // La ligne n'a pas pu être écrite : on ne laisse pas un domaine orphelin chez Resend.
    try { await resend('DELETE', `/domains/${cree.id}`); } catch (err: any) {
      logger.error('[domaines] domaine orphelin chez Resend après échec d’insert', { orgId, resendId: cree.id, error: err?.message });
    }
    throw error;
  }
  oublierCacheDomaine(orgId);
  logger.info('[domaines] domaine déclaré', { orgId, domain, resendId: cree.id });
  return { ...(data as DomaineEnvoi), dns_records: enregistrementsDepuisResend((data as DomaineEnvoi).dns_records) };
}

/** Demande la vérification à Resend puis relit l'état ; met à jour statut, enregistrements, dates. */
export async function verifierDomaine(admin: SupabaseClient, orgId: string): Promise<DomaineEnvoi> {
  const ligne = await lireDomaine(admin, orgId);
  if (!ligne) throw erreurHttp('No sending domain configured.', 404);
  if (!ligne.resend_domain_id) throw erreurHttp('Sending domain has no provider id.', 409);

  // verify ne renvoie que { object, id } : l'état vient du GET qui suit.
  await resend('POST', `/domains/${ligne.resend_domain_id}/verify`);
  const etat = await resend<DomaineResend>('GET', `/domains/${ligne.resend_domain_id}`);
  const status = statutDepuisResend(etat.status);
  const maintenant = new Date().toISOString();
  const records = enregistrementsDepuisResend(etat.records);

  const { data, error } = await admin
    .from(TABLE)
    .update({
      status,
      dns_records: records.length ? records : ligne.dns_records,
      last_checked_at: maintenant,
      verified_at: status === 'verified' ? (ligne.verified_at || maintenant) : null,
      updated_at: maintenant,
    })
    .eq('id', ligne.id)
    .select()
    .single();
  if (error) throw error;
  oublierCacheDomaine(orgId);
  logger.info('[domaines] vérification', { orgId, domain: ligne.domain, status });
  return { ...(data as DomaineEnvoi), dns_records: enregistrementsDepuisResend((data as DomaineEnvoi).dns_records) };
}

/** Retire le domaine chez Resend et efface la ligne : les envois repartent de la plateforme. */
export async function retirerDomaine(admin: SupabaseClient, orgId: string): Promise<void> {
  const ligne = await lireDomaine(admin, orgId);
  if (!ligne) return;
  if (ligne.resend_domain_id) {
    try {
      await resend('DELETE', `/domains/${ligne.resend_domain_id}`);
    } catch (err: any) {
      // Déjà retiré côté Resend : on efface quand même chez nous.
      if (err?.status !== 404) throw err;
    }
  }
  const { error } = await admin.from(TABLE).delete().eq('id', ligne.id);
  if (error) throw error;
  oublierCacheDomaine(orgId);
  logger.info('[domaines] domaine retiré', { orgId, domain: ligne.domain });
}
