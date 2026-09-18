/**
 * Étage 5 : l'aide AVANT le modèle — le patron de tous les CRM.
 * ─────────────────────────────────────────────────────────────
 * Jobber, HubSpot, Zoho : une question « comment je fais X ? » va d'abord à un
 * centre d'aide (recherche par mots-clés, gratuite), et l'IA n'intervient que
 * si la recherche ne trouve rien. Leur coût d'inférence est quasi nul non pas
 * parce que leur modèle est moins cher, mais parce qu'il est le DERNIER
 * recours, pas le premier.
 *
 * Chez nous, `chercherAide` (server/lib/agent/tools-aide.ts) est un excellent
 * moteur — radicaux, synonymes du parler client, pondération titre/FAQ, 37/40
 * dans le top 3 sur la sonde de 40 questions naturelles — mais il n'était
 * exposé QUE comme outil du modèle (`search_help`). Autrement dit : il fallait
 * payer un appel pour atteindre une recherche déjà gratuite et déjà bonne.
 * Mesuré le 2026-09-18 : 91 % des tours passaient par le modèle.
 *
 * Ce module appelle la même recherche AVANT le modèle et ne répond que si le
 * résultat est franc. Tout le reste descend au modèle, comme avant.
 *
 * Quand on répond ici (toutes les conditions) :
 *  - la question ressemble à un « comment faire » (pas une action, pas une
 *    question sur les données du compte — mêmes garde-fous que la FAQ) ;
 *  - la recherche rend un premier résultat au score >= SCORE_FRANC ;
 *  - ce premier résultat DÉTACHE le second (facteur ÉCART) : deux pages
 *    également plausibles, c'est au modèle de choisir ;
 *  - la conversation commence (pas de contexte à perdre).
 *
 * La réponse cite la page de l'app, comme le fait le modèle : le client reçoit
 * le même service, instantanément, pour 0 token.
 *
 * Tests : tests/support/articles-dabord.test.ts
 */
import { chercherAide } from '../agent/tools-aide';
import { porteSurLesDonnees } from './faq';
import { normaliser } from '../lumi/normaliser';

/** Score minimal du premier résultat : en dessous, la recherche « devine ». */
export const SCORE_FRANC = 6;
/** Le premier doit valoir au moins ce multiple du second, sinon c'est ambigu. */
export const FACTEUR_ECART = 1.6;
/** Au-delà, la question porte un cas particulier : elle descend au modèle. */
export const MOTS_MAXIMUM = 16;

/**
 * Marques d'une vraie question « comment faire » : c'est ce que le centre
 * d'aide sait traiter. Sans l'une d'elles, on ne tente rien.
 *
 * Comparées sur l'énoncé NORMALISÉ (sans accents ni ponctuation) : le client
 * écrit « où est… » et « puis-je… », pas « ou est » ni « puis je ». Tester le
 * texte brut faisait rater toutes les questions accentuées — attrapé par le
 * test le 2026-09-18.
 */
const MARQUES_COMMENT = [
  /\b(comment|how)\b/,
  /\b(ou est|ou se trouve|ou je|ou dois je|where)\b/,
  /\b(c est quoi|qu est ce que|qu est ce qui|what is|a quoi sert)\b/,
  /\b(est ce que je peux|puis je|can i|je peux tu|peut on)\b/,
];

export interface ReponseAide {
  texte: string;
  /** Pages citées, pour la trace. */
  pages: string[];
  score: number;
}

/** true si l'énoncé a la forme d'une question « comment faire » (accents et ponctuation ignorés). */
export function estQuestionComment(message: string): boolean {
  const plat = normaliser(message).join(' ');
  return MARQUES_COMMENT.some((r) => r.test(plat));
}

/**
 * Cherche une réponse dans l'aide. `null` = rien d'assez franc, le modèle
 * prend la suite (c'est le cas par défaut, volontairement).
 */
export function reponseAideDirecte(
  message: string,
  langue: 'fr' | 'en',
  opts: { premierMessage: boolean },
): ReponseAide | null {
  if (!opts.premierMessage) return null;
  if (!message.trim()) return null;
  if (normaliser(message).length > MOTS_MAXIMUM) return null;
  // Mêmes refus que la FAQ : une action ou une question sur les données du
  // compte n'est jamais servie par un article.
  if (porteSurLesDonnees(message)) return null;
  if (!estQuestionComment(message)) return null;

  const trouves = chercherAide(message, 3);
  if (!trouves.length) return null;
  const premier = trouves[0];
  const second = trouves[1]?.score ?? 0;
  if (premier.score < SCORE_FRANC) return null;
  if (second > 0 && premier.score < second * FACTEUR_ECART) return null;

  // Une réponse courte qui cite la page, comme le modèle le ferait.
  const extrait = premier.extrait.trim().replace(/\s+/g, ' ').slice(0, 400);
  const texte = langue === 'fr'
    ? `${extrait}\n\n→ ${premier.titre} (${premier.page})\n\nSi ça ne règle pas ton cas, dis-le-moi et je creuse.`
    : `${extrait}\n\n→ ${premier.titre} (${premier.page})\n\nIf that doesn’t cover your case, tell me and I’ll dig further.`;
  return { texte, pages: trouves.map((t) => t.page), score: premier.score };
}
