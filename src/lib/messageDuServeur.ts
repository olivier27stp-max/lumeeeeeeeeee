/* ═══════════════════════════════════════════════════════════════
   Le texte à MONTRER d'une réponse d'erreur du serveur.

   Un refus de permission arrive avec deux textes : `error`, technique et
   en anglais (« Permission denied: automations.update » — un contrat que
   des tests et des appelants comparent), et `message` / `message_en`, la
   phrase lisible. Les écrans affichaient `error` tel quel (audit du
   2026-10-01). On préfère la phrase lisible, dans la langue de
   l'interface ; sans elle, `error` — la plupart des routes y mettent déjà
   une phrase en français.
   ═══════════════════════════════════════════════════════════════ */

import { interfaceEnFrancais } from './champs/messages';

/** `null` quand le corps ne porte aucun texte exploitable : à l'appelant de donner son repli. */
export function messageDuServeur(corps: unknown): string | null {
  if (!corps || typeof corps !== 'object') return null;
  const c = corps as { error?: unknown; message?: unknown; message_en?: unknown };
  const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  if (!interfaceEnFrancais()) return texte(c.message_en) ?? texte(c.message) ?? texte(c.error);
  return texte(c.message) ?? texte(c.error);
}
