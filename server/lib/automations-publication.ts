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

export type ResultatPublication =
  | { ok: true; id: string; is_active: boolean; name: string }
  | { ok: false; id: string; statut: 403 | 404 | 422 | 500; erreur: string; problemes?: string[] };

/** Le message affiché quand la publication est refusée — il NOMME les problèmes. */
export function messageRefus(problemes: string[]): string {
  return `Publication refusée : ${problemes.join(' · ')}`;
}

/** Les problèmes bloquants d'une règle, en texte (vide = publiable). */
export function problemesBloquants(regle: RegleAPublier): string[] {
  return bloquantsPublication({ ...regle, fr: true }).map((p) => p.message);
}

export async function changerPublication(
  client: SupabaseClient,
  orgId: string,
  id: string,
  actif: boolean,
): Promise<ResultatPublication> {
  const { data: regle, error: lectureErr } = await client
    .from('automation_rules')
    .select('id, name, trigger_event, conditions, steps, actions, is_preset, is_active, deleted_at')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (lectureErr) {
    logger.error('[publication] lecture échouée', { rule_id: id, message: lectureErr.message });
    return { ok: false, id, statut: 500, erreur: 'Impossible de lire l’automatisation.' };
  }
  if (!regle) return { ok: false, id, statut: 404, erreur: 'Automatisation introuvable.' };

  if (actif) {
    if (regle.deleted_at) {
      return {
        ok: false, id, statut: 422,
        erreur: 'Cette automatisation est à la corbeille : restaurez-la avant de la publier.',
      };
    }
    const problemes = problemesBloquants(regle as RegleAPublier);
    if (problemes.length > 0) {
      return { ok: false, id, statut: 422, erreur: messageRefus(problemes), problemes };
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
      return { ok: false, id, statut: 403, erreur: 'Votre rôle ne permet pas de publier une automatisation.' };
    }
    logger.error('[publication] écriture échouée', { rule_id: id, message: error.message, code: error.code });
    return { ok: false, id, statut: 500, erreur: 'Impossible de changer le statut de l’automatisation.' };
  }
  const ligne = (data ?? [])[0] as { id: string; name: string; is_active: boolean } | undefined;
  if (!ligne) {
    return { ok: false, id, statut: 403, erreur: 'Votre rôle ne permet pas de publier une automatisation.' };
  }
  if (ligne.is_active !== actif) {
    return { ok: false, id, statut: 500, erreur: 'La modification n’a pas été appliquée — réessayez.' };
  }
  return { ok: true, id: ligne.id, is_active: ligne.is_active, name: ligne.name };
}
