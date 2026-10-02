/* ═══════════════════════════════════════════════════════════════
   Publier / repasser en brouillon — LE seul chemin qui écrit `is_active`
   vers « publiée ».

   Avant (audit 2026-09-28, M8), cinq chemins écrivaient le statut sans
   aucune vérification : l'interrupteur et le lot de la liste, les pages
   Réglages › Messagerie et Avis (`toggleAutomationRule`, écriture directe
   PostgREST), l'outil Lumi `toggle_automation_rule`, et le PATCH de la
   règle. Seul l'éditeur refusait un parcours cassé — côté navigateur.

   Ici, la vérification est faite côté serveur, sur la version ENREGISTRÉE
   de la règle, avec le module partagé `bloquantsPublication`. Repasser en
   brouillon n'est jamais refusé : arrêter d'écrire aux clients doit
   toujours être possible.

   Lecture et preuve de droit avec le client de l'UTILISATEUR (RLS :
   écriture = `automations.update`). Seule l'écriture `is_active = true`
   part avec le rôle de service — la base la refuse à une session
   d'utilisateur (voir `changerPublication`).
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { bloquantsPublication, type RegleAPublier } from '../../src/lib/publicationAutomatisation';
import { champQuiFixeLEntite, entiteDuChamp } from '../../src/lib/automationCatalogue';
import { logger } from './logger';
import { MESSAGES_EN } from './automations-langue';
import { getServiceClient } from './supabase';

export type ResultatPublication =
  /** `updated_at` : la version de la règle APRÈS ce changement (garde de version de l'éditeur, A-09). */
  | { ok: true; id: string; is_active: boolean; name: string; updated_at?: string }
  | { ok: false; id: string; statut: 403 | 404 | 422 | 500; erreur: string; problemes?: string[] };

/** Le message affiché quand la publication est refusée — il NOMME les problèmes. */
export function messageRefus(problemes: string[], fr = true): string {
  return fr ? `Publication refusée : ${problemes.join(' · ')}` : `Publishing refused: ${problemes.join(' · ')}`;
}

/** Refus d'une modification qui casserait une automatisation PUBLIÉE (A-03). */
export function messagePublieeCassee(problemes: string[], fr = true): string {
  return fr
    ? `Cette automatisation est publiée : cette modification l’empêcherait de fonctionner (${problemes.join(' · ')}). Corrigez-la, ou repassez-la en brouillon d’abord.`
    : `This automation is published: this change would stop it from working (${problemes.join(' · ')}). Fix it, or switch it back to draft first.`;
}

/** Les problèmes bloquants d'une règle, en texte (vide = publiable). */
export function problemesBloquants(regle: RegleAPublier, fr = true): string[] {
  return bloquantsPublication({ ...regle, fr }).map((p) => p.message);
}

/**
 * L'ENTITÉ QUE LES RÉGLAGES DE LA RÈGLE FIXENT (triage actions, lignes 5 et 7).
 *
 * « Date atteinte » sur un champ date du PIPELINE fait arriver une
 * opportunité ; « Champ personnalisé modifié » fait arriver la fiche du champ
 * surveillé. Le serveur jugeait sur le seul déclencheur : il refusait de
 * publier « Assigner l'opportunité » que l'éditeur venait d'offrir, et
 * publiait sans broncher « Envoyer la facture » sur un champ du client.
 *
 * La règle partagée (`champQuiFixeLEntite`) dit où lire le champ ; on y lit
 * son objet avec le client de l'UTILISATEUR (la RLS borne au bureau). Champ
 * non choisi, introuvable ou lecture en échec : `null` — on juge alors sur le
 * déclencheur seul, comme avant.
 */
export async function entiteDeLaRegle(
  client: SupabaseClient,
  orgId: string,
  regle: { trigger_event?: string | null; conditions?: Record<string, unknown> | null },
): Promise<string | null> {
  const idChamp = champQuiFixeLEntite(regle.trigger_event, regle.conditions);
  if (!/^[0-9a-f-]{36}$/i.test(idChamp)) return null;
  const { data, error } = await client.from('custom_fields').select('object_type').eq('id', idChamp).eq('org_id', orgId).maybeSingle();
  if (error) {
    logger.error('[publication] objet du champ surveillé illisible', { field_id: idChamp, message: error.message });
    return null;
  }
  return entiteDuChamp((data as { object_type?: string | null } | null)?.object_type);
}

/**
 * Le rôle de service, pour la SEULE écriture `is_active = true` (voir
 * `changerPublication`). Chargé à l'usage : ce module est importé par des
 * tests et des outils qui n'ont pas de clé de service.
 */
let serviceInjecte: SupabaseClient | null = null;
function ecrireParService(): SupabaseClient {
  return serviceInjecte ?? getServiceClient();
}
/** Pour les tests : remplace le client de service (rendre `null` pour revenir au vrai). */
export function definirClientDeServicePourTests(client: SupabaseClient | null): void {
  serviceInjecte = client;
}

/**
 * Active une règle APRÈS une écriture réussie de l'utilisateur sur cette même
 * règle (c'est elle, la preuve de droit) — pour les chemins qui ne passent pas
 * par les contrôles de publication : la copie vers d'autres bureaux reprend
 * l'état de l'original, sans le rejuger.
 */
export async function activerApresEcritureUtilisateur(orgId: string, id: string): Promise<{ error: { message: string; code?: string } | null; updated_at?: string }> {
  const { data, error } = await ecrireParService()
    .from('automation_rules')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select('updated_at');
  // La version APRÈS activation : la réponse de la route doit porter celle-ci
  // (garde de version de l'éditeur, A-09), pas celle de l'écriture d'avant.
  const version = ((data ?? []) as Array<{ updated_at?: string | null }>)[0]?.updated_at;
  return { error, ...(version ? { updated_at: String(version) } : {}) };
}

export async function changerPublication(
  client: SupabaseClient,
  orgId: string,
  id: string,
  actif: boolean,
  /** Langue de l'interface de l'appelant (A-09) : les refus sont dits dans sa langue. */
  fr = true,
): Promise<ResultatPublication> {
  const t = (m: string) => (fr ? m : (MESSAGES_EN[m] ?? m));
  const { data: regle, error: lectureErr } = await client
    .from('automation_rules')
    .select('id, name, trigger_event, conditions, steps, actions, is_preset, is_active, deleted_at')
    .eq('id', id)
    .eq('org_id', orgId)
    // Supprimée définitivement : elle n'existe plus (404) — ni « restaurez-la »,
    // ni dépublication qui écrirait dessus.
    .is('purged_at', null)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[publication] lecture échouée', { rule_id: id, message: lectureErr.message });
    return { ok: false, id, statut: 500, erreur: t('Impossible de lire l’automatisation.') };
  }
  if (!regle) return { ok: false, id, statut: 404, erreur: t('Automatisation introuvable.') };

  if (actif) {
    if (regle.deleted_at) {
      return {
        ok: false, id, statut: 422,
        erreur: t('Cette automatisation est à la corbeille : restaurez-la avant de la publier.'),
      };
    }
    const entite = await entiteDeLaRegle(client, orgId, regle as RegleAPublier);
    const problemes = problemesBloquants({ ...(regle as RegleAPublier), entite }, fr);
    if (problemes.length > 0) {
      return { ok: false, id, statut: 422, erreur: messageRefus(problemes, fr), problemes };
    }
  }

  /*
   * PUBLIER s'écrit en deux temps (audit du 2026-10-01, roles-05).
   *
   * Un membre qui a le droit de modifier les automatisations pouvait écrire
   * `is_active = true` DIRECTEMENT par l'API de la base, sans passer ici :
   * une règle au texto vide se publiait. La base refuse donc à une session
   * d'utilisateur de faire passer `is_active` de faux à vrai (déclencheur
   * `automation_rules_garde`) ; seul le serveur, après les contrôles
   * ci-dessus, l'écrit avec son rôle de service.
   *
   *   1. la PREUVE DE DROIT, avec le client de l'utilisateur : une écriture
   *      sans effet (`updated_at`) que la RLS n'accepte que pour qui a
   *      « modifier les automatisations » dans CE bureau ;
   *   2. la publication, avec le rôle de service, bornée au même bureau.
   *
   * Repasser en brouillon reste une écriture ordinaire de l'utilisateur :
   * arrêter d'écrire aux clients n'a besoin d'aucun détour.
   */
  const horodatage = new Date().toISOString();
  const ecriture = actif
    ? await (async () => {
      const preuve = await client
        .from('automation_rules')
        .update({ updated_at: horodatage })
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id');
      if (preuve.error || !(preuve.data ?? []).length) return { data: [] as unknown[], error: preuve.error };
      return ecrireParService()
        .from('automation_rules')
        .update({ is_active: true, updated_at: horodatage })
        .eq('id', id)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .select('id, name, is_active, updated_at');
    })()
    // `.select()` : une ligne filtrée par la RLS ne doit pas passer pour un succès.
    : await client
      .from('automation_rules')
      .update({ is_active: false, updated_at: horodatage })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, name, is_active, updated_at');
  const { data, error } = ecriture;

  if (error) {
    if (error.code === '42501') {
      return { ok: false, id, statut: 403, erreur: t('Votre rôle ne permet pas de publier une automatisation.') };
    }
    logger.error('[publication] écriture échouée', { rule_id: id, message: error.message, code: error.code });
    return { ok: false, id, statut: 500, erreur: t('Impossible de changer le statut de l’automatisation.') };
  }
  const ligne = (data ?? [])[0] as { id: string; name: string; is_active: boolean; updated_at?: string | null } | undefined;
  if (!ligne) {
    return { ok: false, id, statut: 403, erreur: t('Votre rôle ne permet pas de publier une automatisation.') };
  }
  if (ligne.is_active !== actif) {
    return { ok: false, id, statut: 500, erreur: t('La modification n’a pas été appliquée — réessayez.') };
  }
  return { ok: true, id: ligne.id, is_active: ligne.is_active, name: ligne.name, ...(ligne.updated_at ? { updated_at: String(ligne.updated_at) } : {}) };
}

/**
 * Renvoie l'identifiant d'une automatisation citée par une étape
 * (démarrer / arrêter) qui n'existe pas dans ce bureau, ou `null`.
 * Lu avec le client de l'utilisateur : la RLS borne au bureau.
 */
export async function refAutomatisationInventee(
  client: SupabaseClient,
  orgId: string,
  etapes: unknown[],
): Promise<string | null> {
  const cibles = etapes
    .map((e) => (e as { action?: { type?: string; config?: { rule_id?: unknown } } }).action)
    .filter((act) => act?.type === 'demarrer_automatisation' || act?.type === 'arreter_automatisation')
    .map((act) => String(act?.config?.rule_id ?? ''));
  for (const id of cibles) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return id || '(vide)';
    const { data } = await client.from('automation_rules').select('id').eq('id', id).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
    if (!data) return id;
  }
  return null;
}
