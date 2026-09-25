/**
 * Domaine d'envoi propre à une entreprise (2026-09-17) — « chaque entreprise
 * envoie depuis son propre domaine », comme Salesforce.
 *
 * Les identités vivent chez Amazon SES (`ses-identites.ts`) depuis le
 * 2026-09-24. Elles étaient déclarées chez Resend, resté câblé après la
 * migration de la plateforme vers SES : sans `RESEND_API_KEY`, `demanderDomaine`
 * répondait 503 et AUCUNE entreprise ne pouvait faire partir ses courriels de
 * son propre domaine. Le client de ses clients recevait factures et devis de
 * la part de `noreply@lumecrm.net`.
 *
 * SES n'a pas d'identifiant opaque : le domaine est la clé de l'identité, et
 * `resend_domain_id` le porte (colonne conservée, pas de migration). Les
 * statuts DKIM de SES (SUCCESS / PENDING / FAILED / NOT_STARTED /
 * TEMPORARY_FAILURE) sont ramenés à trois : pending / verified / failed.
 *
 * La table `org_sending_domains` est écrite ici seulement (service_role) ;
 * `expediteurDe` est ce que `senderForOrg` (routes/emails.ts) consulte avant
 * chaque envoi, derrière un cache mémoire de 5 min par org.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { creerIdentite, lireIdentite, supprimerIdentite } from './ses-identites';

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

/** Le statut DKIM de SES ramené à nos trois états. */
export function statutDepuisSes(statut: unknown): StatutDomaine {
  switch (String(statut ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'verified';
    case 'FAILED':
      return 'failed';
    default:
      // PENDING, NOT_STARTED, TEMPORARY_FAILURE : le client n'a pas fini de publier.
      return 'pending';
  }
}

/** Les 3 CNAME DKIM de SES au format que la carte des réglages affiche. */
export function enregistrementsDepuisSes(dkim: Array<{ name: string; value: string }> | undefined): EnregistrementDns[] {
  if (!Array.isArray(dkim)) return [];
  return dkim
    .filter((d) => d?.name && d?.value)
    .map((d) => ({ record: 'DKIM', type: 'CNAME', name: d.name, value: d.value, ttl: null, priority: null, status: null }));
}

/** Les enregistrements DNS d'une réponse Resend — gardé pour relire les lignes écrites avant le portage. */
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

/** Déclare le domaine chez SES et l'enregistre en attente, avec les CNAME DKIM à coller. */
export async function demanderDomaine(admin: SupabaseClient, orgId: string, domaineSaisi: unknown): Promise<DomaineEnvoi> {
  const domain = validerDomaine(domaineSaisi);
  const existant = await lireDomaine(admin, orgId);
  if (existant) throw erreurHttp('A sending domain is already configured. Remove it first.', 409);

  const identite = await creerIdentite(domain);

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      org_id: orgId,
      domain,
      // SES n'a pas d'identifiant opaque : le domaine EST la clé de l'identité.
      resend_domain_id: domain,
      from_local_part: PARTIE_LOCALE_DEFAUT,
      // Même garde qu'à la vérification : 'verified' exige VerifiedForSendingStatus.
      status: identite.verifie ? 'verified' : (statutDepuisSes(identite.statut) === 'verified' ? 'pending' : statutDepuisSes(identite.statut)),
      dns_records: enregistrementsDepuisSes(identite.dkim),
      last_checked_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    // La ligne n'a pas pu être écrite : on ne laisse pas une identité orpheline chez SES.
    try { await supprimerIdentite(domain); } catch (err: any) {
      logger.error('[domaines] identité orpheline chez SES après échec d’insert', { orgId, domain, error: err?.message });
    }
    throw error;
  }
  oublierCacheDomaine(orgId);
  logger.info('[domaines] domaine déclaré', { orgId, domain });
  return { ...(data as DomaineEnvoi), dns_records: enregistrementsDepuisResend((data as DomaineEnvoi).dns_records) };
}

/** Demande la vérification à Resend puis relit l'état ; met à jour statut, enregistrements, dates. */
export async function verifierDomaine(admin: SupabaseClient, orgId: string): Promise<DomaineEnvoi> {
  const ligne = await lireDomaine(admin, orgId);
  if (!ligne) throw erreurHttp('No sending domain configured.', 404);
  // SES vérifie tout seul dès que les CNAME sont publiés : rien à déclencher,
  // on relit simplement l'état de l'identité.
  const etat = await lireIdentite(ligne.domain);
  // `verified` exige VerifiedForSendingStatus, pas seulement un DKIM signé :
  // SES peut avoir validé les CNAME sans autoriser l'envoi, et les courriels
  // partiraient alors d'un domaine qu'il rejette.
  const statutDkim = statutDepuisSes(etat.statut);
  const status: StatutDomaine = etat.verifie ? 'verified' : (statutDkim === 'verified' ? 'pending' : statutDkim);
  const maintenant = new Date().toISOString();
  const records = enregistrementsDepuisSes(etat.dkim);

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

/** Retire l'identité chez SES et efface la ligne : les envois repartent de la plateforme. */
export async function retirerDomaine(admin: SupabaseClient, orgId: string): Promise<void> {
  const ligne = await lireDomaine(admin, orgId);
  if (!ligne) return;
  try {
    await supprimerIdentite(ligne.domain);
  } catch (err: any) {
    // Déjà retirée côté SES : on efface quand même chez nous.
    if (err?.status !== 404) throw err;
  }
  const { error } = await admin.from(TABLE).delete().eq('id', ligne.id);
  if (error) throw error;
  oublierCacheDomaine(orgId);
  logger.info('[domaines] domaine retiré', { orgId, domain: ligne.domain });
}
