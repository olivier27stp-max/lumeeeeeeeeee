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

   Client de l'UTILISATEUR (RLS : écriture = `automations.update`), jamais
   service_role.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { bloquantsPublication, type RegleAPublier } from '../../src/lib/publicationAutomatisation';
import { logger } from './logger';
import { MESSAGES_EN } from './automations-langue';

export type ResultatPublication =
  | { ok: true; id: string; is_active: boolean; name: string }
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
    const problemes = problemesBloquants(regle as RegleAPublier, fr);
    if (problemes.length > 0) {
      return { ok: false, id, statut: 422, erreur: messageRefus(problemes, fr), problemes };
    }
  }

  // `.select()` : une ligne filtrée par la RLS ne doit pas passer pour un succès.
  const { data, error } = await client
    .from('automation_rules')
    .update({ is_active: actif, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, name, is_active');

  if (error) {
    if (error.code === '42501') {
      return { ok: false, id, statut: 403, erreur: t('Votre rôle ne permet pas de publier une automatisation.') };
    }
    logger.error('[publication] écriture échouée', { rule_id: id, message: error.message, code: error.code });
    return { ok: false, id, statut: 500, erreur: t('Impossible de changer le statut de l’automatisation.') };
  }
  const ligne = (data ?? [])[0] as { id: string; name: string; is_active: boolean } | undefined;
  if (!ligne) {
    return { ok: false, id, statut: 403, erreur: t('Votre rôle ne permet pas de publier une automatisation.') };
  }
  if (ligne.is_active !== actif) {
    return { ok: false, id, statut: 500, erreur: t('La modification n’a pas été appliquée — réessayez.') };
  }
  return { ok: true, id: ligne.id, is_active: ligne.is_active, name: ligne.name };
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
