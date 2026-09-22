/**
 * Réponse au VRAI hors-sujet, sans appeler le gros modèle (2026-09-22).
 * ─────────────────────────────────────────────────────────────────────
 * Le routeur Haiku classe déjà chaque message et rend `hors_scope` avec une
 * confiance élevée — « Rien à voir avec l'entreprise ni avec Lume :
 * actualités, code, blagues, sujets personnels ». Mais ce verdict était
 * CALCULÉ puis JETÉ : la route ne traitait que `decision === 'action'`, et
 * ces questions descendaient quand même à Sonnet.
 *
 * Mesuré en prod : 14 tours classés hors_scope à 0,95 de confiance,
 * 0,26 $ dépensés, alors que le routeur les avait identifiés pour 0,36 ¢.
 *
 * Ce qu'on NE traite pas ici, volontairement : les questions sur Lume
 * lui-même (forfaits, annulation, ce que fait le produit). Elles ressemblent
 * à du hors-sujet pour le routeur, mais la FAQ et le centre d'aide y
 * répondent déjà — et mieux, avec le contenu écrit à la main. Elles sont
 * interceptées AVANT le routeur dans la route ; si l'une passe quand même
 * jusqu'ici, `mentionneLume` la renvoie au modèle plutôt que de servir un
 * refus à quelqu'un qui pose une question légitime sur le produit.
 *
 * Tests : tests/lumi-hors-scope.test.ts
 */
import { normaliser } from './normaliser';

/**
 * Indices que la question porte sur LUME (produit, forfait, compte) plutôt
 * que sur un sujet extérieur. Dans le doute, on laisse le modèle répondre :
 * un refus servi à tort est bien pire qu'un appel payé.
 */
const MOTS_LUME = [
  'lume', 'lumi', 'forfait', 'abonnement', 'plan', 'facturation', 'compte',
  'crm', 'logiciel', 'application', 'app', 'fonctionnalite', 'fonction',
  'prix', 'tarif', 'essai', 'support', 'aide', 'humain', 'equipe',
];

/** true si l'énoncé parle de Lume ou du compte : ne jamais le traiter comme hors-sujet. */
export function mentionneLume(message: string): boolean {
  const mots = new Set(normaliser(message));
  return MOTS_LUME.some((m) => mots.has(m));
}

/**
 * Réponse au hors-sujet. Courte, sans reproche, et elle RAMÈNE vers ce que
 * Lumi sait faire — une porte fermée doit toujours en montrer une ouverte.
 */
export function reponseHorsScope(langue: 'fr' | 'en'): string {
  return langue === 'fr'
    ? 'Ça sort de ce que je peux voir : je travaille dans ton CRM — clients, jobs, devis, factures, horaire, équipe. Demande-moi ton chiffre du mois, tes retards, ta journée de demain, et je te sors les vrais chiffres.'
    : "That's outside what I can see: I work inside your CRM — clients, jobs, quotes, invoices, schedule, team. Ask me about your revenue, overdue invoices or tomorrow's schedule and I'll pull the real numbers.";
}

/**
 * Faut-il répondre soi-même plutôt que d'appeler le gros modèle ?
 * Toutes les conditions doivent tenir — au moindre doute, le modèle répond.
 */
export function peutRepondreHorsScope(opts: {
  decision: string | undefined;
  confiance: number | undefined;
  seuil: number;
  message: string;
  premierMessage: boolean;
}): boolean {
  if (opts.decision !== 'hors_scope') return false;
  if (!opts.confiance || opts.confiance < opts.seuil) return false;
  // En cours de conversation, « et ça ? » peut porter sur le sujet précédent :
  // le modèle a le contexte, pas nous.
  if (!opts.premierMessage) return false;
  // Une question sur Lume n'est pas du hors-sujet : la FAQ ou le modèle répond.
  if (mentionneLume(opts.message)) return false;
  return true;
}
