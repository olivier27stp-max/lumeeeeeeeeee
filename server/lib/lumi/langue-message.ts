/**
 * La langue d'UN message — pour les étages qui répondent sans modèle.
 * ──────────────────────────────────────────────────────────────────
 * Le modèle répond dans la langue du message : sur la passe de référence du
 * 2026-10-01, 40 questions posées en anglais sur 43 ont reçu une réponse en
 * anglais. Les trois autres venaient des étages gratuits (aide écrite,
 * raccourcis), qui répondaient dans la langue DU COMPTE : « How many invoices
 * are overdue? » recevait un article en français.
 *
 * Détection volontairement prudente : il faut au moins deux mots-outils d'une
 * langue ET qu'elle l'emporte nettement sur l'autre. Dans le doute (« ok »,
 * « facture 12 », un nom propre), on garde la langue du compte — c'est le
 * comportement d'avant, jamais pire.
 */
import { normaliser } from './normaliser';

const MOTS_EN = new Set([
  'the', 'what', 'whats', 'how', 'is', 'are', 'was', 'were', 'my', 'do', 'does', 'did', 'can', 'could', 'you', 'your',
  'of', 'to', 'for', 'and', 'which', 'who', 'where', 'when', 'why', 'this', 'that', 'have', 'has', 'please', 'show',
  'me', 'many', 'much', 'with', 'from', 'any', 'there', 'on', 'in', 'it', 'i', 'we', 'our', 'his', 'her', 'their',
  'send', 'give', 'tell', 'list', 'right', 'now', 'today', 'tomorrow', 'yesterday', 'week', 'month', 'owes', 'owe',
]);
const MOTS_FR = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'est', 'sont', 'mon', 'ma', 'mes', 'je', 'tu', 'comment', 'quoi',
  'quel', 'quelle', 'quels', 'quelles', 'ou', 'et', 'pour', 'dans', 'sur', 'que', 'qui', 'combien', 'ce', 'ca', 'cette',
  'ai', 'as', 'peux', 'veux', 'pas', 'avec', 'au', 'aux', 'il', 'elle', 'on', 'nous', 'vous', 'moi', 'toi', 'son', 'sa',
  'ses', 'envoie', 'donne', 'montre', 'liste', 'aujourd', 'hui', 'demain', 'hier', 'semaine', 'mois', 'pis', 'faut',
]);

export function langueDuMessage(message: string, defaut: 'fr' | 'en'): 'fr' | 'en' {
  let en = 0;
  let fr = 0;
  for (const mot of normaliser(message)) {
    if (MOTS_EN.has(mot)) en++;
    if (MOTS_FR.has(mot)) fr++;
  }
  if (en >= 2 && en >= fr * 2) return 'en';
  if (fr >= 2 && fr >= en * 2) return 'fr';
  return defaut;
}
