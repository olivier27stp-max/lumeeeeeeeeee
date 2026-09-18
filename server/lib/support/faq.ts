/**
 * Questions classiques du support (étage 0) — comme les suggestions du widget
 * d'accueil : un clic sur une question de la FAQ a une réponse écrite à la
 * main, la même à chaque fois. La faire répondre par le modèle coûterait un
 * appel pour une réponse qu'on connaît d'avance.
 *
 * Deux niveaux de correspondance, du plus sûr au plus large :
 *
 *  1. EXACTE (normalisée) avec une question de la FAQ — le comportement
 *     d'origine, conservé tel quel.
 *  2. PAR MOTS-CLÉS (2026-09-18) — la même réponse quand la question porte
 *     sans ambiguïté sur le même sujet, écrite autrement.
 *
 * Pourquoi le niveau 2. Mesuré en prod sur les traces : « mon paiement a
 * échoué je fais quoi » a été payé 8 fois, « comment je change de plan » 3
 * fois, « comment je parle à un humain » 2 fois. Ce sont des questions SUR LE
 * PRODUIT : la réponse ne dépend ni de l'org, ni des données du client, ni de
 * la date — elle est déjà écrite dans ARTICLES. Chaque client qui la pose
 * autrement coûtait un appel complet, et ce coût montait avec le nombre de
 * clients. Ici il tombe à zéro et n'augmente plus.
 *
 * Prudence, parce qu'une FAQ servie à tort est pire qu'un appel payé :
 *  - il faut au moins DEUX signaux concordants (score >= SCORE_MINIMUM), pour
 *    qu'un seul mot commun ne suffise jamais ;
 *  - un écart net est exigé avec le deuxième article (MARGE_MINIMUM) : deux
 *    sujets aussi plausibles l'un que l'autre descendent au modèle ;
 *  - toute question portant sur les DONNÉES de l'org (« mes », « mon devis
 *    numéro… », un chiffre, une date) est refusée d'office : « comment
 *    annuler une facture » est une question produit, « annule ma facture
 *    INV-0004 » est une action, et confondre les deux serait un bug grave ;
 *  - seules les questions assez courtes sont éligibles : une longue phrase
 *    porte presque toujours un cas particulier que la FAQ ne couvre pas.
 *
 * Tests : tests/support/faq-mots-cles.test.ts
 */
import { ARTICLES } from '../../../src/components/supportArticles';
import { normaliser } from '../lumi/normaliser';

const cle = (s: string): string => normaliser(s).join(' ');

export interface ReponseFaq { id: string; reponse: string; path: string | null }

/** Deux signaux concordants au minimum : un seul mot commun ne déclenche jamais une réponse toute faite. */
export const SCORE_MINIMUM = 2;
/** Écart exigé avec le deuxième meilleur sujet : sans écart net, on laisse le modèle trancher. */
export const MARGE_MINIMUM = 1;
/** Au-delà, la question porte un cas particulier : elle descend au modèle. */
export const MOTS_MAXIMUM = 14;

/**
 * Mots vides : trop fréquents pour valoir un signal. Sans cette liste, « comment »
 * ou « lume » rapprocherait n'importe quelle question de n'importe quel article.
 */
const MOTS_VIDES = new Set([
  'comment', 'je', 'j', 'mon', 'ma', 'mes', 'me', 'moi', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd',
  'est', 'ce', 'que', 'qui', 'quoi', 'quel', 'quelle', 'quels', 'quelles', 'ou', 'et', 'a', 'au', 'aux', 'en', 'y',
  'il', 'elle', 'on', 'nous', 'vous', 'se', 'sa', 'son', 'ses', 'pour', 'par', 'dans', 'sur', 'avec', 'sans',
  'pas', 'plus', 'faire', 'fais', 'fait', 'puis', 'peux', 'peut', 'veux', 'veut', 'dois', 'doit', 'ai', 'as',
  'lume', 'lumi', 'svp', 'stp', 'merci', 'bonjour', 'salut',
  'how', 'do', 'i', 'my', 'the', 'a', 'an', 'is', 'it', 'to', 'can', 'what', 'where', 'and', 'or', 'for', 'with',
]);

/**
 * Marques d'une question portant sur les DONNÉES de l'org plutôt que sur le
 * produit. Leur présence interdit une réponse toute faite : la FAQ explique
 * comment faire, elle ne répond jamais sur le contenu du CRM.
 */
const MARQUES_DONNEES = [
  // Un numéro de pièce, un montant, une date : la question vise une ligne précise.
  /\b(inv|q|job|facture|devis|soumission)\s*[-#]?\s*\d+/i,
  /\b\d{2,}\b/,
  /\b\d+\s*(\$|dollars?|piastres?)/i,
  // Verbes d'ACTION à l'impératif ou au passé : l'utilisateur demande de faire
  // (ou parle de ce qui vient d'être fait), il ne demande pas qu'on explique.
  // Les formes conjuguées comptent aussi : « ta supprimer le tm8 » est une
  // correction en cours de conversation, pas une question sur le produit.
  /\b(annule|supprim\w*|efface\w*|envoie|envoy\w*|cree|creer|creé\w*|marque|ajoute|ajout\w*|planifie|deplace|relance)\b/i,
  // Renvois au contenu réel du compte.
  /\b(chez|pour le client|de mon client)\b/i,
  // Conversation en cours : une correction, une confirmation, un renvoi à ce
  // qui précède ne sont jamais des questions produit autonomes.
  /\b(non|pas ca|pas le|plutot|au lieu|celui la|celle la|c est lui|c lui|att|attend|oups)\b/i,
];

/** Mots significatifs d'un texte : normalisés, sans mots vides, sans doublons. */
function motsUtiles(texte: string): Set<string> {
  return new Set(normaliser(texte).filter((m) => m.length > 1 && !MOTS_VIDES.has(m)));
}

/** Vocabulaire d'un article : sa question (fr + en) et ses mots-clés. */
function vocabulaireArticle(a: { q_fr: string; q_en: string; tags?: string }): Set<string> {
  return motsUtiles(`${a.q_fr} ${a.q_en} ${a.tags ?? ''}`);
}

/** true si la question porte sur les données de l'org (jamais de réponse toute faite). */
export function porteSurLesDonnees(message: string): boolean {
  return MARQUES_DONNEES.some((r) => r.test(message));
}

function rendre(a: (typeof ARTICLES)[number], langue: 'fr' | 'en'): ReponseFaq {
  const reponse = langue === 'fr' ? a.a_fr : a.a_en;
  const page = a.path ? (langue === 'fr' ? ` (page : ${a.path})` : ` (page: ${a.path})`) : '';
  return { id: a.id, reponse: `${reponse}${page}`, path: a.path ?? null };
}

export function reponseFaqPour(message: string, langue: 'fr' | 'en'): ReponseFaq | null {
  const k = cle(message);
  if (!k) return null;

  // 1. Correspondance exacte — inchangée.
  for (const a of ARTICLES) {
    if (cle(a.q_fr) === k || cle(a.q_en) === k) return rendre(a, langue);
  }

  // 2. Correspondance par mots-clés, sous conditions strictes.
  const mots = motsUtiles(message);
  if (mots.size < SCORE_MINIMUM) return null;
  if (normaliser(message).length > MOTS_MAXIMUM) return null;
  if (porteSurLesDonnees(message)) return null;

  let meilleur: { article: (typeof ARTICLES)[number]; score: number } | null = null;
  let second = 0;
  for (const a of ARTICLES) {
    const vocab = vocabulaireArticle(a);
    let score = 0;
    for (const m of mots) if (vocab.has(m)) score++;
    if (!meilleur || score > meilleur.score) { second = meilleur?.score ?? 0; meilleur = { article: a, score }; }
    else if (score > second) second = score;
  }

  if (!meilleur || meilleur.score < SCORE_MINIMUM) return null;
  if (meilleur.score - second < MARGE_MINIMUM) return null;
  return rendre(meilleur.article, langue);
}
