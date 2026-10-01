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
  return fusionnerAssistantsConsecutifs(propres);
}

const enBlocs = (m: Msg): Anthropic.Messages.ContentBlockParam[] => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);

/** La suite d'un tour de l'assistant, ajoutée au MÊME message (voir fusionnerAssistantsConsecutifs). */
export function suiteDuMemeTour(precedent: Msg, suite: Msg): Msg {
  return { role: 'assistant', content: [...enBlocs(precedent), ...enBlocs(suite)] };
}

/**
 * Deux messages `assistant` de suite n'en font qu'un.
 *
 * Quand le modèle cherche un outil (recherche côté API), l'API peut rendre la
 * main en plein tour (`pause_turn`) : la réponse finit sur la demande de
 * recherche, et son RÉSULTAT arrive au début de la réponse suivante. L'API exige
 * que la demande et son résultat soient dans le même message ; rangés dans deux
 * messages, l'appel d'après est refusé — « tool_search_tool_regex tool use …
 * was found without a corresponding tool_search_tool_result block » — et la
 * personne lit « Lumi n'a pas pu répondre » (passes du 2026-10-01 : 4 puis 7
 * tours sur 221, tous des demandes qui sortent du sujet chargé).
 *
 * L'orchestrateur fusionne maintenant au fil du tour ; ceci répare aussi une
 * conversation enregistrée avant le correctif, qui sinon resterait refusée à
 * chaque message. Pure : ne modifie pas l'entrée.
 */
export function fusionnerAssistantsConsecutifs(messages: Msg[]): Msg[] {
  if (!messages.some((m, i) => i > 0 && m.role === 'assistant' && messages[i - 1].role === 'assistant')) return messages;
  const out: Msg[] = [];
  for (const m of messages) {
    const precedent = out[out.length - 1];
    if (m.role === 'assistant' && precedent?.role === 'assistant') out[out.length - 1] = suiteDuMemeTour(precedent, m);
    else out.push(m);
  }
  return out;
}

/** Ce qu'on garde d'un message ancien de la personne, et du rappel entier (≈ 1 500 tokens au plus). */
export const RAPPEL_MAX_PAR_MESSAGE = 240;
export const RAPPEL_MAX_MESSAGES = 30;

/**
 * La fenêtre de l'historique : les `max` derniers messages, SANS oublier ce que
 * la personne a dit avant, et sans faire glisser la coupe à chaque tour.
 *
 * Avant (2026-10-01) la conversation était coupée net à ses 60 derniers
 * messages, et la coupe avançait à chaque tour :
 *  - tout ce que la personne avait dit plus tôt disparaissait (« le dossier
 *    bleu, c'est la facture 12 » au tour 4 n'existait plus au tour 48) ;
 *  - le début de l'historique changeant à chaque tour, le cache de la
 *    conversation était réécrit en entier à chaque message d'une longue
 *    conversation (1,25 × le tarif d'entrée) au lieu d'être relu (0,1 ×).
 *
 * Maintenant :
 *  - la coupe avance par PAS (un tiers de la fenêtre) : entre deux pas, le
 *    début de l'historique ne bouge pas et le cache est relu ;
 *  - les messages TEXTE de la personne qui sortent de la fenêtre sont gardés,
 *    abrégés, dans un rappel placé en tête. Ce sont ses mots, pas ceux du
 *    modèle ni des résultats d'outils : mêmes droits que le reste de ce
 *    qu'elle écrit. S'il y en a trop, on garde les premiers (c'est au début
 *    qu'on pose les conventions) et les plus récents.
 *
 * La coupe tombe toujours sur un message texte de la personne — jamais entre
 * une action et son résultat. Pure : ne modifie pas l'entrée.
 */
export function fenetreAvecRappel(messages: Msg[], max: number): Msg[] {
  if (messages.length <= max) return messages;
  const pas = Math.max(2, Math.floor(max / 3));
  let i = Math.ceil((messages.length - max) / pas) * pas;
  const texteUtilisateur = (m: Msg): boolean => m.role === 'user' && typeof m.content === 'string';
  while (i < messages.length && !texteUtilisateur(messages[i])) i++;
  const gardes = messages.slice(i);
  if (!gardes.length) return gardes;
  const anciens = messages.slice(0, i)
    .filter((m) => texteUtilisateur(m) && String(m.content).trim().length > 0)
    .map((m) => String(m.content).trim().replace(/\s+/g, ' ').slice(0, RAPPEL_MAX_PAR_MESSAGE));
  if (!anciens.length) return gardes;
  const tete = Math.ceil(RAPPEL_MAX_MESSAGES / 3);
  const retenus = anciens.length <= RAPPEL_MAX_MESSAGES
    ? anciens
    : [...anciens.slice(0, tete), '[…]', ...anciens.slice(anciens.length - (RAPPEL_MAX_MESSAGES - tete))];
  const rappel = [
    '<messages_precedents>',
    'Messages plus anciens de cette même conversation, écrits par la personne (les réponses et les résultats d’outils ont été retirés pour alléger). Ce qu’elle y a dit reste valable.',
    ...retenus.map((t) => `- ${t}`),
    '</messages_precedents>',
  ].join('\n');
  const premier = gardes[0];
  return [{ role: 'user', content: `${rappel}\n\n${String(premier.content)}` }, ...gardes.slice(1)];
}
