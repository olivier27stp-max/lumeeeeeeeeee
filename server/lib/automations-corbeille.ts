/* ═══════════════════════════════════════════════════════════════
   Une automatisation À LA CORBEILLE ne se modifie pas, ne se duplique pas
   et ne se teste pas : on la restaure d'abord.

   L'écran ne l'offre pas (la corbeille ne propose que « Restaurer » et
   « Supprimer définitivement », l'éditeur affiche « à la corbeille »), mais
   les routes répondaient quand même à qui les appelait directement (audit
   du 2026-10-01, constats roles-08 à roles-10). Elles refusent toutes avec
   le MÊME statut (409) et la MÊME phrase, dite dans la langue de
   l'interface.

   Une règle supprimée DÉFINITIVEMENT (`purged_at`), elle, n'existe plus
   pour l'utilisateur : les lectures la filtrent (`.is('purged_at', null)`)
   et les routes répondent 404 « Automatisation introuvable. ».
   ═══════════════════════════════════════════════════════════════ */

/** Statut d'un refus « à la corbeille » : la requête est valide, l'état de la règle s'y oppose. */
export const STATUT_CORBEILLE = 409;

/** La phrase du refus, dans la langue de l'interface. */
export function messageCorbeille(fr: boolean): string {
  return fr
    ? 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.'
    : 'This automation is in the bin: restore it to edit it.';
}
