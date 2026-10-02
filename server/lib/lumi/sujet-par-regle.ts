/**
 * Sujet d'un ORDRE trouvé par règle, sans appeler le routeur (coût, 2026-10-01).
 * ─────────────────────────────────────────────────────────────────────────
 * Le routeur (Haiku) coûte ~0,15 ¢ et ~0,7 s par demande : 12 % du coût mesuré
 * en prod. Pour un ORDRE (« supprime la soumission 3 »), son action déterministe
 * n'est jamais utilisée (un ordre va toujours au modèle, voir demande-action.ts) :
 * il ne sert qu'à choisir le sujet, donc le jeu d'outils chargé.
 *
 * Quand le vocabulaire de la phrase ne désigne QU'UN sujet, la règle le donne
 * gratuitement. Mesuré hors ligne sur les 459 cas de l'éval (vérité = l'outil
 * attendu est dans le jeu chargé) : voir tests/lumi-sujet-par-regle.test.ts.
 * Dès qu'il y a un doute (deux sujets, aucun), la règle se tait et le routeur
 * tranche comme avant. Les questions (lectures) passent TOUJOURS par le routeur :
 * il sait y répondre seul par un raccourci à 0,15 ¢.
 *
 * `LUMI_SUJET_PAR_REGLE=0` coupe la règle.
 */
import type { IdTopic } from './topics';

/** Texte en minuscules, sans accents (les règles sont écrites ainsi). */
function plat(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").toLowerCase();
}

/** Mots qui désignent un sujet. Une phrase qui en touche DEUX n'est pas tranchée par la règle. */
const VOCABULAIRE: Array<[IdTopic, RegExp]> = [
  ['devis', /\b(soumissions?|devis|quotes?|estimates?|prereglages?|presets?)\b/],
  ['facturation', /\b(factures?|facturer|invoices?|bill|inv-\d+|rembourse\w*|refunds?|relances?|reminders?|taxes?|tps|tvq|jalons? de facturation|recurring invoices?|factures? recurrentes?|carte au dossier|card on file|versements?|payouts?)\b/],
  ['planification', /\b(jobs?|visites?|visits?|calendrier|planifi\w+|replanifi\w+|deplanifi\w+|reschedule\w*|unschedule\w*|trajets?|tournee|recurrence|checklists?|listes? de verification|etiquettes? de job|job tags?|contrats?|agreements?|disponibilites?|availability)\b/],
  ['clients', /\b(clients?|clientes?|prospects?|leads?|fiches?|doublons?|fusionne\w*|merge|proprietes?|propert(?:y|ies)|adresses? de service|pipeline|deals?|champs? personnalises?|custom fields?|archives?|restaur\w*|restore|consentements?|consent)\b/],
  // Un canal n'est un sujet que s'il y a une intention d'ENVOI : « a changé de courriel » parle d'une fiche.
  ['communications', /\b(envoie|envoyer|ecris|redige|reponds|repondre|send|write|draft|reply|answer)\b[^.]{0,40}\b(textos?|sms|courriels?|emails?|e-mails?|messages?)\b|^(texte|text)\b|\b(modeles? de courriel|email templates?)\b/],
  ['equipe', /\b(equipes?|teams?|crews?|employes?|techniciens?|invitations?|roles?|acces|permissions?|paie|payroll|pay period|timesheets?|feuilles? de temps|punch\w*|pointe\w*|pointages?|commissions?|conges?|time off|taux horaire|hourly rate|taches?|tasks?)\b/],
  ['rapports', /\b(rapports?|reports?|automatisations?|automations?|objectifs?|goals?|notifications?)\b/],
  ['terrain', /\b(porte-a-porte|porte a porte|door[- ]to[- ]door|d2d|territoires?|territor(?:y|ies)|maisons?|houses?|session terrain|field session|defis?|challenges?|badges?|batailles?|battles?|formations?|courses?|lecons?|lessons?)\b/],
  ['memoire', /\b(retiens|souviens-toi|rappelle-toi|oublie|remember|forget|garde en memoire|a partir de maintenant|from now on)\b/],
];

/**
 * « l'automatisation X », « mes automatisations », « un rappel automatique », "my automation".
 * PAS « relances automatiques » : ce sont les relances de paiement (un autre réglage, sujet facturation).
 */
const AUTOMATISATION = /\b(automatisations?|automations?|parcours automatiques?|(?:rappels?|suivis?|textos?|courriels?|messages?|reponses?) automatiques?|automatic (?:reminders?|follow-?ups?|texts?|emails?|messages?|repl(?:y|ies)))\b/;

/**
 * Le sujet d'un ordre quand un seul vocabulaire est touché, sinon null.
 * Jamais appelé pour une question : voir la route.
 */
export function sujetParRegle(message: string): IdTopic | null {
  if (process.env.LUMI_SUJET_PAR_REGLE === '0') return null;
  const e = plat(message).trim();
  if (e.length < 8 || e.length > 400) return null;
  // Une AUTOMATISATION parle toujours aussi d'autre chose — devis, factures, textos, clients :
  // « change le texto de l'automatisation Relance de soumission » touchait trois vocabulaires,
  // la règle se taisait, et le routeur payant était appelé à CHAQUE message d'automatisation
  // (12 sur 12 mesurés, 8 % du coût, 1,1 à 1,7 s — constat F-11). Le mot tranche : c'est le
  // sujet qui charge les outils d'automatisation.
  if (AUTOMATISATION.test(e)) return 'rapports';
  const touches = VOCABULAIRE.filter(([, re]) => re.test(e)).map(([t]) => t);
  return touches.length === 1 ? touches[0] : null;
}
