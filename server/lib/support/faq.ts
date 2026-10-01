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
import { REPONSES_TU, type Voix } from './faq-tutoiement';

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
  // Possessif + entité : « combien J'AI DE clients », « MES factures »,
  // « MON équipe ». La question porte sur le CONTENU du compte, pas sur le
  // produit — et une Q/R du genre « Combien de clients je peux avoir ? » (une
  // limite de forfait) y ressemble dangereusement. Fuite attrapée le
  // 2026-09-22 en branchant la FAQ produit sur le centre d'aide.
  // « combien j'ai de X », « X que j'ai », « j'ai combien de X » : le verbe
  // AVOIR à la 1re personne près d'une entité = on interroge le contenu.
  /\bj ?ai\b[^.?]{0,20}\b(clients?|factures?|jobs?|devis|soumissions?|t[aâ]ches?|employ[ée]s?|[ée]quipe|revenus?)\b/i,
  /\b(clients?|factures?|jobs?|devis|soumissions?|t[aâ]ches?)\b[^.?]{0,20}\bj ?ai\b/i,
  // Possessif COLLÉ à l'entité (« mes factures », « mon équipe ») ET suivi
  // d'un verbe d'état : on demande leur situation, pas comment faire.
  // « comment importer MES CLIENTS depuis Excel » reste une question produit.
  /\b(mes|mon|ma|nos|notre)\s+(clients?|factures?|jobs?|devis|soumissions?|t[aâ]ches?|employ[ée]s?|[ée]quipe|revenus?|chiffre)\b[^.?]{0,30}\b(sont|est|ont|a|payee?s?|en retard|impay[ée]s?|combien|fait)\b/i,
  // Un numéro de pièce, un montant, une date : la question vise une ligne précise.
  /\b(inv|q|jobs?|factures?|devis|soumissions?|invoices?|quotes?|estimates?)\s*(?:n[o°º]\.?|num[ée]ro|number|[-#])?\s*\d+/i,
  /\b\d{2,}\b/,
  /\b\d+\s*(\$|dollars?|piastres?)/i,
  // Verbes d'ACTION à l'impératif ou au passé : l'utilisateur demande de faire
  // (ou parle de ce qui vient d'être fait), il ne demande pas qu'on explique.
  // Les formes conjuguées comptent aussi : « ta supprimer le tm8 » est une
  // correction en cours de conversation, pas une question sur le produit.
  /\b(annule|supprim\w*|efface\w*|envoie|envoy\w*|cree|creer|creé\w*|marque|ajoute|ajout\w*|planifie|deplace|relance)\b/i,
  // Le message arrive NON normalisé : « Crée » (é puis e) échappait à la
  // règle ci-dessus, et « Crée un rappel automatique par texto la veille de
  // chaque rendez-vous » recevait l'article « SMS » au lieu de l'automatisation
  // demandée (40-iklm-lumi-demandes, I-002). Même garde pour l'anglais.
  // Sauf si la phrase est une QUESTION sur la marche à suivre (« Comment
  // configurer mes taxes », « How do I set up taxes for Quebec? ») : celle-là
  // garde sa réponse d'aide.
  /^(?!\s*(comment|how|o[uù]|where|pourquoi|why|est-ce|can\s+i|puis-je|peut-on)(?![\p{L}]))(?=.*(^|[^\p{L}])(cr[eé][eé]\w*|automatis\w*|programme|configure|mets en place|create|set up|automate|make)(?![\p{L}]))/iu,
  // Renvois au contenu réel du compte.
  /\b(chez|pour le client|de mon client)\b/i,
  // « C'est quoi MES préréglages », « montre-moi mes modèles », « what checklist
  // templates DO I HAVE », « show me my taxes » : on demande ce que CONTIENT le
  // compte (audit des outils de Lumi, 2026-09-30 — ces questions recevaient une
  // FAQ, parfois hors sujet : les gabarits de listes → la page Taxes).
  // « Comment configurer mes taxes » reste une question produit (pas de marque ici).
  /\b(c[’' ]?est quoi|c[’' ]?est qui|quels? sont|quelles? sont|montre[ -]?moi|liste[ -]?moi|donne[ -]?moi|affiche[ -]?moi)\s+(mes|mon|ma|nos|notre)\b/i,
  /\b(what|which)\b[^.?]{0,50}\b(do|did|have) i\s+(have|got|set up|setup|configured)\b/i,
  /\b(show|list|give|tell)\s+me\s+(all\s+)?my\b/i,
  // Conversation en cours : une correction, une confirmation, un renvoi à ce
  // qui précède ne sont jamais des questions produit autonomes.
  /\b(non|pas ca|pas le|plutot|au lieu|celui la|celle la|c est lui|c lui|att|attend|oups)\b/i,
  // « J'AI COMBIEN DE clients » : le quantificateur s'intercale entre le verbe
  // et l'entité, donc la fenêtre de 20 caractères plus haut ne le voit pas.
  // Mesuré le 2026-09-23 (qa:lumi) : la question partait à l'article « combien
  // de clients je peux avoir » — une limite de forfait pour quelqu'un qui
  // voulait le compte de SES clients.
  /\bj ?ai\b\s*(combien|cb)\b/i,
  /\b(combien|cb)\b[^.?]{0,15}\b(j ?ai|on a|nous avons)\b/i,
  // « combien de X impayées / en retard / ce mois-ci » : l'état ou la période
  // ramène la question au contenu, même sans possessif.
  /\b(combien|cb)\b[^.?]{0,30}\b(impay[ée]\w*|en retard|en cours|ouvert\w*|actif\w*|ce mois|cette semaine|aujourd ?hui)\b/i,
  // Possessif + entité, SANS exiger un verbe d'état : « le courriel de mon
  // entreprise », « l'adresse de ma compagnie » portent sur le compte même
  // sans « est » ni « sont ». La règle plus haut ne couvrait que les formes
  // avec verbe ; celle-ci attrape la question nominale.
  /\b(de|du|dans)\s+(mon|ma|mes|notre|nos)\s+(entreprise|compagnie|business|crm|compte|organisation|boite)\b/i,
  // Une coordonnée demandée POUR QUELQU'UN : « le numéro de téléphone de
  // Ginette Desrosiers », « le courriel de M. Tremblay ». Un nom propre (deux
  // majuscules, ou un prénom suivi d'un nom) après « de » ne peut désigner
  // qu'une fiche du compte — jamais le produit. Même mesure, même passe :
  // la question partait à l'article d'activation des SMS.
  // Les accents comptent : le message arrive tel que tapé (« numéro »), il
  // n'est pas normalisé avant d'arriver ici. Et « Comment ajouter un numéro
  // de téléphone à une fiche ? » doit rester une question PRODUIT : la règle
  // ne s'applique donc pas quand la phrase commence par « comment » — avec ou
  // sans majuscule : la règle n'a pas le drapeau `i` (elle repère les noms
  // propres), et « Comment… » en début de phrase lui échappait (2026-10-01).
  /^(?!\s*[Cc]omment\b)(?=.*\b(num[ée]ro|t[ée]l|t[ée]l[ée]phone|courriel|email|adresse|solde|montant)\b[^.?]{0,25}\bde\s+(M\.|Mme|Mlle)?\s*[A-ZÀ-Þ][\wÀ-ÿ'-]+)/,
  // ── Passe de référence du 2026-10-01 (220 demandes en prod) : six questions sur
  // les données du compte ont reçu un article, dont une réponse fausse (« aucune
  // limite » à « combien de clients ai-je au total »). Les trous, un par un :
  //
  // Le nom propre arrive aussi après « à » (parler québécois : « le numéro à
  // Jean-François Pelletier »), « pour », « chez », et derrière une PIÈCE autant
  // qu'une coordonnée (« la facture de Pelletier »). Un nom propre = une fiche.
  /^(?!\s*[Cc]omment\b)(?=.*\b(num[ée]ro|t[ée]l|t[ée]l[ée]phone|cell|courriel|email|adresse|solde|montant|factures?|devis|soumissions?|jobs?|contrats?|paiements?|visites?|rendez-vous|fiche|dossier)\b[^.?]{0,25}\s(de|du|à|a|pour|chez)\s+(M\.|Mme|Mlle)?\s*[A-ZÀ-Þ][\wÀ-ÿ'-]+)/,
  /^(?!\s*[Hh]ow\b)(?=.*\b(phone|number|email|address|balance|invoices?|quotes?|estimates?|jobs?|payments?|visits?)\b[^.?]{0,25}\s(of|for|from)\s+(Mr\.?|Mrs\.?|Ms\.?)?\s*[A-Z][\w'-]+)/,
  /\b[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?[’']s\s+(phone|number|email|address|balance|invoices?|quotes?|estimates?|jobs?|payments?|visits?|file)\b/,
  // « qui me doit de l'argent », « ce qu'on me doit », « who owes me » : une créance
  // est toujours une ligne du compte.
  /\b(me|nous)\s+doi(t|vent)\b/i,
  /\b(owes?|owed|owing)\b/i,
  // « combien de clients AI-JE », « avons-nous », « au total », « en tout » : le
  // verbe inversé et le total échappaient aux règles « j'ai combien » plus haut.
  /\b(combien|cb)\b[^.?]{0,40}\b(ai[- ]je|avons[- ]nous|a[- ]t[- ]on|au total|en tout)\b/i,
  // L'état AVANT le quantificateur : « … en retard, pis combien chacun ».
  /\b(impay[ée]\w*|en retard|en souffrance)\b[^?]{0,40}\b(combien|cb)\b/i,
  // « est-ce que mes clients REÇOIVENT un rappel » : ce que les clients reçoivent
  // dépend des réglages et des automatisations de CE compte, pas du produit.
  /\b(mes|nos)\s+(clients?|employ[ée]s?|techniciens?)\b[^.?]{0,15}\b(re[cç]oi\w*|ont re[cç]u|ont pay[ée]|ont sign[ée]|ont accept[ée])\b/i,
  // L'anglais n'avait aucune règle de quantité : « How many invoices are overdue
  // right now » partait à l'article « facture impayée ». « How many clients CAN I
  // have », « how much does it COST » et « how much is the Scale PLAN » restent des
  // questions produit (limites et prix des forfaits).
  /\bhow\s+(many|much)\b(?![^.?]*\b(can|could|may|allowed|costs?|included?|includes|limit|maximum|max|plans?|price[sd]?|pricing|subscription|lume|minimum|scale|autopilot)\b)/i,
  /\b(who|which|what)\b[^.?]{0,40}\b(overdue|unpaid|outstanding|past due|late)\b/i,
];

/**
 * Mots significatifs d'un texte : normalisés, sans mots vides, sans doublons.
 * Exporté : `articles-dabord` s'en sert pour comparer une question au titre
 * d'une Q/R — une seule définition de « mot utile » pour les deux étages.
 */
export function motsUtiles(texte: string): Set<string> {
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

function rendre(a: (typeof ARTICLES)[number], langue: 'fr' | 'en', voix: Voix): ReponseFaq {
  // Lumi tutoie, le support vouvoie : même article, deux voix (faq-tutoiement.ts).
  const reponse = langue === 'fr' ? (voix === 'tu' ? REPONSES_TU[a.id] ?? a.a_fr : a.a_fr) : a.a_en;
  const page = a.path ? (langue === 'fr' ? ` (page : ${a.path})` : ` (page: ${a.path})`) : '';
  return { id: a.id, reponse: `${reponse}${page}`, path: a.path ?? null };
}

export function reponseFaqPour(message: string, langue: 'fr' | 'en', voix: Voix = 'vous'): ReponseFaq | null {
  const k = cle(message);
  if (!k) return null;

  // 1. Correspondance exacte — inchangée.
  for (const a of ARTICLES) {
    if (cle(a.q_fr) === k || cle(a.q_en) === k) return rendre(a, langue, voix);
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
  return rendre(meilleur.article, langue, voix);
}
