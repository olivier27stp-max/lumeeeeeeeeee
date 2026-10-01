/**
 * Historique rejoué au modèle : ce que l'API accepte, et rien d'autre.
 *
 * La base garde aussi des blocs d'AFFICHAGE que l'interface relit mais que
 * l'API ne connaît pas — `{ type: 'fiches' }`, posé par le briefing du matin
 * (`briefing.ts`). Et une conversation de briefing COMMENCE par un message de
 * Lumi : aucun message utilisateur avant.
 *
 * Avant (2026-10-01), `chargerHistorique` rejouait ces messages tels quels :
 * répondre dans la conversation du briefing — là où mène la notification du
 * matin — envoyait un bloc inconnu et un premier message `assistant`, que
 * l'API refuse. 73 briefings en production, aucune réponse encore : le premier
 * client à répondre aurait eu « Lumi n'a pas pu répondre ».
 */
import type Anthropic from '@anthropic-ai/sdk';

type Msg = Anthropic.Messages.MessageParam;

/** Blocs gardés en base pour l'interface seulement : jamais envoyés au modèle. */
const BLOCS_D_AFFICHAGE: ReadonlySet<string> = new Set(['fiches']);

/** Ce qui tient lieu de question quand une conversation commence par un message de Lumi. */
export const AMORCE_BRIEFING = '(Lumi a envoyé ce message de lui-même : le briefing du matin.)';

/**
 * Rend un historique valide pour l'API : blocs d'affichage retirés, messages
 * devenus vides écartés, et un premier message toujours de rôle `user`.
 * Pure : ne modifie pas l'entrée, ne touche pas à la base.
 */
export function assainirPourApi(messages: Msg[]): Msg[] {
  const propres: Msg[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.content.trim().length) propres.push(m);
      continue;
    }
    const blocs = m.content.filter((b) => !BLOCS_D_AFFICHAGE.has((b as { type?: string }).type ?? ''));
    if (!blocs.length) continue;
    propres.push(blocs.length === m.content.length ? m : { ...m, content: blocs });
  }
  if (propres.length && propres[0].role === 'assistant') propres.unshift({ role: 'user', content: AMORCE_BRIEFING });
  return propres;
}
