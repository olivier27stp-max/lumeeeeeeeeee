/**
 * Plusieurs questions produit collées dans un seul message (2026-09-22).
 * ─────────────────────────────────────────────────────────────────────
 * Les gens collent des listes. Mesuré en prod : quatre questions dont
 * CHACUNE a une réponse écrite à la main, envoyées d'un coup, ont coûté
 * 2,65 ¢ et 5,5 s — parce que le bloc entier ne ressemble à aucune question
 * connue et part au modèle.
 *
 * On découpe donc sur les sauts de ligne (et les puces) et on répond ligne
 * par ligne avec les mêmes fonctions que pour un message simple. Le coût
 * tombe à zéro et la réponse est instantanée.
 *
 * Deux règles pour ne pas répondre de travers :
 *  - TOUT ou RIEN. Si une seule ligne n'a pas de réponse toute faite, on rend
 *    `null` et le message entier part au modèle. Répondre à trois questions
 *    sur quatre et taire la dernière serait pire que de tout envoyer : la
 *    personne croirait avoir été comprise.
 *  - Bornes strictes : au-delà de MAX_LIGNES on ne tente rien (un long
 *    copier-coller n'est pas une liste de questions), et les doublons sont
 *    écartés pour ne pas répondre deux fois la même chose.
 *
 * Le découpage se fait uniquement sur les SAUTS DE LIGNE, jamais sur « ? » :
 * une phrase peut contenir un point d'interrogation en son milieu, et couper
 * là produirait des fragments qui ne veulent rien dire.
 *
 * Tests : tests/support/aide-multi.test.ts
 */
import { reponseFaqPour } from './faq';
import { reponseAideDirecte } from './articles-dabord';

/** Au-delà, ce n'est plus une liste de questions mais un copier-coller. */
export const MAX_LIGNES = 6;
/** En deçà, une ligne est un fragment (« oui », « ok »), pas une question. */
export const MIN_CARACTERES = 10;

/** Découpe un message en lignes utiles : puces et numéros retirés, vides écartés. */
export function decouperEnQuestions(message: string): string[] {
  return message
    .split(/\r?\n+/)
    .map((l) => l.trim().replace(/^[-*•–—]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length >= MIN_CARACTERES);
}

export interface ReponseMulti {
  texte: string;
  /** Identifiants des réponses servies, pour la trace. */
  ids: string[];
}

/**
 * Répond à un message contenant PLUSIEURS questions produit. `null` dès
 * qu'une seule ligne n'a pas de réponse toute faite (tout ou rien), ou si le
 * message n'en contient qu'une (c'est alors au chemin normal de répondre).
 */
export function reponseAideMulti(message: string, langue: 'fr' | 'en'): ReponseMulti | null {
  const lignes = decouperEnQuestions(message);
  if (lignes.length < 2 || lignes.length > MAX_LIGNES) return null;

  // Doublons écartés : on ne répond pas deux fois la même chose, mais leur
  // présence ne doit pas faire échouer le lot.
  const vues = new Set<string>();
  const uniques = lignes.filter((l) => {
    const cle = l.toLowerCase().replace(/\s+/g, ' ');
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });

  const morceaux: string[] = [];
  const ids: string[] = [];
  for (const ligne of uniques) {
    const faq = reponseFaqPour(ligne, langue);
    if (faq) { morceaux.push(`**${ligne}**\n${faq.reponse}`); ids.push(`faq:${faq.id}`); continue; }
    const article = reponseAideDirecte(ligne, langue, { premierMessage: true });
    if (article) { morceaux.push(`**${ligne}**\n${article.texte}`); ids.push('aide-directe'); continue; }
    // Tout ou rien : une seule ligne sans réponse et le message part au modèle.
    return null;
  }

  return { texte: morceaux.join('\n\n'), ids };
}
