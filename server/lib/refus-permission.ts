/* ═══════════════════════════════════════════════════════════════
   Le corps d'un 403 « permission manquante ».

   Module à part, sans dépendance : les deux gardes du serveur (`rbac.ts`
   pour `requirePermission`, `route-permissions.ts` pour la table des
   routes) répondent ainsi la MÊME chose.

   Le refus n'était qu'un texte anglais technique (`Permission denied:
   automations.update`) que des écrans affichaient tel quel à un utilisateur
   francophone (audit du 2026-10-01). `error` reste identique — des tests et
   des appelants le comparent ; `message` porte une phrase lisible, sans nom
   de clé.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../src/lib/permissions';

/**
 * La phrase à AFFICHER quand une permission manque. Une phrase par clé qui en
 * mérite une ; tout le reste reçoit la phrase générique.
 */
const REFUS_LISIBLES: Partial<Record<PermissionKey, { fr: string; en: string }>> = {
  'automations.read': {
    fr: 'Votre rôle ne permet pas de voir les automatisations.',
    en: 'Your role does not allow viewing automations.',
  },
  'automations.update': {
    fr: 'Votre rôle ne permet pas de modifier les automatisations.',
    en: 'Your role does not allow editing automations.',
  },
};
const REFUS_GENERIQUE = { fr: 'Votre rôle ne permet pas cette action.', en: 'Your role does not allow this action.' };

export interface CorpsRefusPermission {
  /** CONTRAT — texte technique historique, comparé par des tests et des appelants : ne pas le changer. */
  error: string;
  /** La phrase à montrer à l'utilisateur, en français (la langue par défaut de Lume). */
  message: string;
  /** La même phrase en anglais, pour une interface en anglais. */
  message_en: string;
  /** La clé refusée (ou « a or b » quand l'une OU l'autre suffisait), pour le code — jamais pour l'affichage. */
  permission: string;
}

/**
 * Avec plusieurs clés (l'une OU l'autre suffisait), `error` garde la forme
 * « a or b » du garde des routes.
 */
export function corpsRefusPermission(cles: PermissionKey | readonly PermissionKey[]): CorpsRefusPermission {
  const liste = typeof cles === 'string' ? [cles] : [...cles];
  const refusee = liste.join(' or ');
  const phrase = (liste.length === 1 ? REFUS_LISIBLES[liste[0]] : undefined) ?? REFUS_GENERIQUE;
  return { error: `Permission denied: ${refusee}`, message: phrase.fr, message_en: phrase.en, permission: refusee };
}
