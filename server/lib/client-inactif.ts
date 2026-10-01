/* ═══════════════════════════════════════════════════════════════
   CLIENT INACTIF + LIEN DE RÉSERVATION — drapeau `auto_client_inactif`.

   ── Le déclencheur « Client inactif » ──
   Un balayage toutes les heures ; pour chaque entreprise qui a le drapeau et
   une règle active, pendant la plage de jour de SON fuseau (9 h – 19 h) :
     · inactif depuis N mois = aucun job terminé depuis N mois, aucun job à
       venir, client ni supprimé, ni archivé, ni prospect, et au moins un
       job terminé dans le passé (un ancien client — voir la fonction SQL
       `clients_inactifs`) ;
     · une seule fois par PÉRIODE d'inactivité : la période est le dernier job
       terminé ; un nouveau job terminé la change, le client se réarme ;
     · au plus N déclenchements par entreprise et par heure (réglage de la
       règle, 25 par défaut) : activer la règle chez une entreprise de 400
       clients dormants n'envoie pas 400 textos d'un coup — le reste part aux
       heures suivantes.

   ── Le lien de réservation ──
   Une VARIABLE, pas une action : {{client.lien_reservation}} dans un
   courriel ou un texto. Page publique par jeton, propre au client, 30 jours,
   qui ouvre une demande pré-remplie (nom, adresse, services passés) et la
   dépose dans le pipeline comme le formulaire de demande — sans jamais
   rétrograder le client en prospect.
   ═══════════════════════════════════════════════════════════════ */

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { logger } from './logger';
import { DRAPEAUX_AUTOMATISATIONS } from './automations-drapeaux';
import { resolvePublicBaseUrl } from './helpers';

/** Heure locale d'un fuseau (même calcul que le briefing de Lumi, sans l'importer). */
function heureDansFuseau(fuseau: string, maintenant: Date): { heure: number } {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hour: 'numeric', hour12: false });
    const h = Number(f.formatToParts(maintenant).find((x) => x.type === 'hour')?.value);
    return { heure: (Number.isFinite(h) ? h : 12) % 24 };
  } catch {
    return heureDansFuseau(FUSEAU_DEFAUT, maintenant);
  }
}

export const MOIS_DEFAUT = 6;
export const MAX_PAR_HEURE_DEFAUT = 25;
/** Plage de jour, heure locale de l'entreprise : on ne relance personne la nuit. */
export const HEURE_DEBUT = 9;
export const HEURE_FIN = 19;
export const DUREE_LIEN_JOURS = 30;

const FUSEAU_DEFAUT = 'America/Montreal';

const entier = (v: unknown, defaut: number, min: number, max: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : defaut;
};

/** Les réglages d'une règle « Client inactif », bornés. */
export function reglagesInactivite(conditions: Record<string, unknown> | null | undefined): { mois: number; maxParHeure: number } {
  return {
    mois: entier(conditions?.mois, MOIS_DEFAUT, 1, 60),
    maxParHeure: entier(conditions?.max_par_heure, MAX_PAR_HEURE_DEFAUT, 1, 1000),
  };
}

/** Combien de clients correspondent AUJOURD'HUI (hors ceux déjà déclenchés pour ce seuil). */
export async function compterClientsInactifs(admin: SupabaseClient, orgId: string, mois: number): Promise<number> {
  const { data, error } = await admin.rpc('clients_inactifs', { p_org_id: orgId, p_mois: mois, p_limite: 100000 });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Une passe pour UNE entreprise. Rend le nombre de déclenchements émis.
 * `maintenant` est injectable pour les tests.
 */
export async function balayerEntreprise(admin: SupabaseClient, orgId: string, maintenant = new Date()): Promise<number> {
  const { data: cs } = await admin.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  const { heure } = heureDansFuseau(String((cs as { timezone?: string } | null)?.timezone || FUSEAU_DEFAUT), maintenant);
  if (heure < HEURE_DEBUT || heure >= HEURE_FIN) return 0;

  const { data: regles, error } = await admin
    .from('automation_rules')
    .select('id, conditions')
    .eq('org_id', orgId)
    .eq('trigger_event', 'client.inactive')
    .eq('is_active', true)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  if (!regles?.length) return 0;

  // Une émission par SEUIL : deux règles à 6 mois partent sur le même
  // événement ; une règle à 12 mois a le sien.
  //
  // Le moteur compare CHAQUE clé des conditions de la règle aux métadonnées :
  // l'événement porte donc la liste des valeurs écrites par les règles de ce
  // seuil (une métadonnée liste est vraie si UN élément correspond). Avec une
  // seule valeur (le plafond le plus bas, le seuil borné), une règle à 50 par
  // heure à côté d'une règle à 25 ne partait jamais.
  const seuils = new Map<number, { maxParHeure: number; moisEcrits: Set<unknown>; plafondsEcrits: Set<unknown> }>();
  for (const r of regles as Array<{ conditions: Record<string, unknown> | null }>) {
    const { mois, maxParHeure } = reglagesInactivite(r.conditions);
    const s = seuils.get(mois) ?? { maxParHeure, moisEcrits: new Set<unknown>([mois]), plafondsEcrits: new Set<unknown>([maxParHeure]) };
    s.maxParHeure = Math.min(s.maxParHeure, maxParHeure);
    if (r.conditions?.mois !== undefined && r.conditions?.mois !== null) s.moisEcrits.add(r.conditions.mois);
    if (r.conditions?.max_par_heure !== undefined && r.conditions?.max_par_heure !== null) s.plafondsEcrits.add(r.conditions.max_par_heure);
    s.plafondsEcrits.add(maxParHeure);
    seuils.set(mois, s);
  }

  let emis = 0;
  for (const [mois, { maxParHeure, moisEcrits, plafondsEcrits }] of seuils) {
    // Le plafond vaut pour L'ENTREPRISE : on compte tout ce qui est parti
    // dans la dernière heure, tous seuils confondus.
    const depuis = new Date(maintenant.getTime() - 3600_000).toISOString();
    const { count, error: cErr } = await admin
      .from('clients_inactifs_declenches')
      .select('client_id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('declenche_at', depuis);
    if (cErr) throw new Error(cErr.message);
    const restant = maxParHeure - (count ?? 0);
    if (restant <= 0) continue;

    const { data: candidats, error: rErr } = await admin.rpc('clients_inactifs', { p_org_id: orgId, p_mois: mois, p_limite: restant });
    if (rErr) throw new Error(rErr.message);
    for (const c of (candidats ?? []) as Array<{ client_id: string; periode: string; dernier_job_at: string | null }>) {
      // Réserver AVANT d'émettre : deux passes concurrentes ne font partir
      // qu'un message (clé primaire org + client + seuil + période).
      const { error: insErr } = await admin.from('clients_inactifs_declenches').insert({
        org_id: orgId, client_id: c.client_id, mois, periode: c.periode,
      });
      if (insErr) {
        if ((insErr as { code?: string }).code !== '23505') logger.error('[client-inactif] réservation refusée', { orgId, message: insErr.message });
        continue;
      }
      await eventBus.emit('client.inactive', {
        orgId,
        entityType: 'client',
        entityId: c.client_id,
        metadata: {
          client_id: c.client_id,
          // Les réglages de la règle voyagent avec l'événement : le moteur
          // compare chaque clé de `conditions` aux métadonnées.
          mois: [...moisEcrits],
          max_par_heure: [...plafondsEcrits],
          periode: c.periode,
          dernier_job_termine_at: c.dernier_job_at,
        },
      });
      emis++;
    }
  }
  return emis;
}

/** Passe du cron : toutes les entreprises qui ont le drapeau. */
export async function balayerClientsInactifs(admin: SupabaseClient, maintenant = new Date()): Promise<number> {
  const { data, error } = await admin
    .from('org_features')
    .select('org_id')
    .eq('feature', DRAPEAUX_AUTOMATISATIONS.clientInactif)
    .eq('enabled', true);
  if (error) { logger.error('[client-inactif] entreprises illisibles', { message: error.message }); return 0; }
  let total = 0;
  for (const orgId of [...new Set((data ?? []).map((l: { org_id: string }) => String(l.org_id)))]) {
    try {
      total += await balayerEntreprise(admin, orgId, maintenant);
    } catch (e: unknown) {
      logger.error('[client-inactif] entreprise en échec', { orgId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return total;
}

// ── Liens de réservation ────────────────────────────────────

export const empreinteJeton = (jeton: string) => createHash('sha256').update(jeton).digest('hex');

/** Crée un lien de 30 jours pour CE client. Seule l'empreinte est gardée. */
export async function creerLienReservation(admin: SupabaseClient, orgId: string, clientId: string, maintenant = new Date()): Promise<string> {
  const jeton = randomBytes(32).toString('hex');
  const { error } = await admin.from('liens_reservation').insert({
    org_id: orgId,
    client_id: clientId,
    jeton_hash: empreinteJeton(jeton),
    expires_at: new Date(maintenant.getTime() + DUREE_LIEN_JOURS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return `${resolvePublicBaseUrl()}/reserver/${jeton}`;
}

export type LienLu =
  | { etat: 'valide'; lienId: string; orgId: string; clientId: string }
  | { etat: 'expire' }
  | { etat: 'inconnu' };

/** Le lien de ce jeton. Un jeton ne donne accès qu'à SON client. */
export async function lireLienReservation(admin: SupabaseClient, jeton: string, maintenant = new Date()): Promise<LienLu> {
  if (!/^[0-9a-f]{64}$/.test(jeton)) return { etat: 'inconnu' };
  const { data, error } = await admin
    .from('liens_reservation')
    .select('id, org_id, client_id, expires_at')
    .eq('jeton_hash', empreinteJeton(jeton))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { etat: 'inconnu' };
  const l = data as { id: string; org_id: string; client_id: string; expires_at: string };
  if (new Date(l.expires_at).getTime() <= maintenant.getTime()) return { etat: 'expire' };
  return { etat: 'valide', lienId: l.id, orgId: l.org_id, clientId: l.client_id };
}

/** Le texte contient-il la variable ? (on ne crée un lien que s'il sert) */
export const demandeLienReservation = (...textes: Array<string | null | undefined>) =>
  textes.some((t) => typeof t === 'string' && /\{\{\s*client\.lien_reservation\s*\}\}/.test(t));
