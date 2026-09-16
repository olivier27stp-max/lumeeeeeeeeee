/**
 * Sous-agents de Lumi (audit B7) — un topic du routeur = un jeu d'outils.
 * ─────────────────────────────────────────────────────────────────────
 * Quand le routeur (étage 5, LUMI_ROUTEUR=actif) classe le premier message
 * dans un topic avec assez de confiance mais sans action déterministe, le
 * tour part au modèle avec SEULEMENT les outils de ce topic chargés (plus
 * les transverses : mémoire, aide, fiche d'entreprise) au lieu des 15 outils
 * du quotidien — et les autres restent découvrables par tool_search. Mesuré :
 * le bloc d'outils pesait 2 478 tokens relus à chaque échantillonnage ;
 * un topic en charge 800 à 1 400. Le préfixe est cache par topic (7 entrées,
 * partagées par toutes les orgs). Le bloc système stable ne change PAS : le
 * sujet du tour est ajouté au bloc variable (pas de nouvelle empreinte).
 *
 * Aucun topic reconnu (routeur off, doute, multi, hors scope) → jeu de base.
 */
import { TOPICS, type IdTopic } from './topics';
import { TOOLS_BY_NAME } from '../agent/tools';
import { SEUIL_CONFIANCE, type ResultatRouteur } from './routeur';
import { reglesCout } from './regles-cout';

/** Chargés avec tout sous-agent : mémoire de Lumi, aide sur Lume, fiche d'entreprise. */
export const OUTILS_TRANSVERSES: readonly string[] = ['recall_notes', 'remember_this', 'forget_note', 'search_help', 'get_company_info'];

/** Topics qui ne définissent pas un sous-agent (pas de jeu d'outils propre). */
const SANS_SOUS_AGENT: ReadonlySet<string> = new Set(['hors_scope', 'multi']);

export function estSousAgent(topic: string | null | undefined): topic is IdTopic {
  if (!topic || SANS_SOUS_AGENT.has(topic)) return false;
  const t = TOPICS.find((x) => x.id === topic);
  return !!t && t.outils.length > 0;
}

/**
 * Outils chargés pour un sous-agent : TOUS ceux du topic (noyau + couverture) +
 * les transverses. Ordre stable (cache 1 h par topic, 7 à 11 k tokens).
 *
 * Pourquoi tout charger plutôt que le noyau + tool_search (batterie du
 * 2026-09-16, ai_usage) : les définitions chargées par tool_search s'insèrent
 * dans le bloc d'outils, AVANT le prompt système — tout le préfixe qui suit
 * (prompt stable 12 k, conversation) est relu au plein tarif à chaque étape
 * suivante : 27 000 à 30 000 tokens non cachés, 6 à 7 ¢ le tour, plafond
 * atteint. Un jeu complet coûte 0,2 ¢ par étape en lecture cachée et évite
 * l'étape de recherche (≈ 0,6 ¢ + 3 s). Hors sujet courant, tool_search reste.
 */
export function outilsDuSousAgent(topic: IdTopic): string[] {
  const t = TOPICS.find((x) => x.id === topic);
  const noms = [...(t?.outils ?? []), ...OUTILS_TRANSVERSES];
  const vus = new Set<string>();
  return noms.filter((n) => TOOLS_BY_NAME[n] && !vus.has(n) && vus.add(n));
}

/** Le sous-agent à charger d'après le verdict du routeur : topic sûr, sans action déterministe. */
export function sousAgentDepuisVerdict(r: ResultatRouteur | null | undefined): IdTopic | null {
  const v = r?.verdict;
  if (!v || r.statut !== 'ok' || r.decision !== 'modele') return null;
  if (v.confidence < SEUIL_CONFIANCE) return null;
  return estSousAgent(v.topic) ? v.topic : null;
}

/** Ligne ajoutée au bloc VARIABLE du prompt (jamais au bloc stable) quand un sous-agent est chargé. */
/**
 * Consignes propres à un sous-agent (bloc variable). Courtes, et seulement là où
 * l'effort bas rendait le modèle hésitant (batterie du 2026-09-16) :
 *  - memoire : « retiens que… » avec un souvenir semblable déjà en place →
 *    le modèle répondait « déjà noté » sans appeler remember_this ;
 *  - planification : « crée un job… » → il demandait s'il fallait des articles
 *    au lieu de proposer la carte (que l'utilisateur relit de toute façon).
 */
const CONSIGNES_SOUS_AGENT: Partial<Record<IdTopic, { fr: string; en: string }>> = {
  memoire: {
    fr: "Quand on te demande de retenir un fait, appelle remember_this même si un souvenir semblable existe déjà (il est mis à jour) ; ne réponds jamais « déjà noté » sans l'appel.",
    en: 'When asked to remember something, call remember_this even if a similar note already exists (it gets updated); never answer "already noted" without the call.',
  },
  planification: {
    fr: 'Pour créer ou déplacer un job, propose la carte tout de suite avec ce qui est fourni (articles vides permis) : pas de question préalable sur les articles ou les prix, l’utilisateur relit la carte.',
    en: 'To create or move a job, propose the card right away with what was given (empty items allowed): no preliminary question about items or prices, the user reviews the card.',
  },
  facturation: {
    fr: 'Pour une écriture (devis, facture, marquer payée, relances), appelle l’outil tout de suite avec ce qui est fourni : la carte de confirmation EST la question, ne demande pas « je le fais ? » en texte.',
    en: 'For a write (quote, invoice, mark paid, reminders), call the tool right away with what was given: the confirmation card IS the question, do not ask "should I?" in text.',
  },
  communications: {
    fr: 'Pour un texto ou un courriel, appelle send_sms / send_email tout de suite avec le texte complet : la carte montre le message exact et le destinataire, c’est elle qui demande le OK.',
    en: 'For a text or an email, call send_sms / send_email right away with the full text: the card shows the exact message and recipient, it is what asks for the OK.',
  },
};

/**
 * Sujets qui raisonnent vraiment : réflexion medium ; les autres suivent la
 * règle stricte (low). Mesuré (batterie du 2026-09-16) : facturation en medium
 * a FAIT PERDRE deux actions (le modèle posait des questions au lieu de
 * proposer la carte) et doublé le coût des tours modèle (0,58 → 1,03 ¢) ;
 * seuls les rapports restent en medium.
 */
export const SOUS_AGENTS_COMPLEXES: ReadonlySet<IdTopic> = new Set<IdTopic>(['rapports']);
export function effortDuSousAgent(topic: IdTopic | null | undefined): 'low' | 'medium' {
  return topic && SOUS_AGENTS_COMPLEXES.has(topic) ? 'medium' : reglesCout().effort_defaut;
}

export function focusDuSousAgent(topic: IdTopic, langue: 'fr' | 'en'): string {
  const t = TOPICS.find((x) => x.id === topic);
  const sujet = t?.description ?? topic;
  const consigne = CONSIGNES_SOUS_AGENT[topic]?.[langue];
  // Batterie du 2026-09-16 (passe 4) : 13 « je confirme ? » en texte au lieu de la carte, dans TOUS les sujets.
  const carte = langue === 'fr'
    ? " Toute écriture demandée clairement : appelle l'outil tout de suite avec ce qui est fourni — la carte de confirmation EST la question, ne demande jamais « je confirme ? » ou « je le fais ? » en texte."
    : ' Any clearly requested write: call the tool right away with what was given — the confirmation card IS the question, never ask "shall I?" in text.';
  return (langue === 'fr'
    ? `Sujet de ce tour : ${sujet} Les outils de ce sujet sont chargés ; si la demande en sort, cherche l'outil avec tool_search_tool_regex.`
    : `Topic of this turn: ${sujet} This topic's tools are loaded; if the request goes beyond it, look the tool up with tool_search_tool_regex.`)
    + carte + (consigne ? ` ${consigne}` : '');
}
