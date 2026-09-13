/**
 * Réponses fixes de l'agent public (item 5, étage 0 — Q1 de COST_AUDIT.md).
 * ─────────────────────────────────────────────────────────────────
 * Les trois suggestions cliquables du widget d'accueil (LumiAgent.tsx) ont
 * un texte fixe : le même énoncé, mot pour mot, à chaque clic. Le faire
 * répondre par Gemini coûtait un appel (1 415 tokens de prompt mesurés)
 * pour une réponse qu'on connaît d'avance. Ici : énoncé normalisé →
 * réponse écrite à la main, tirée des MÊMES faits que le prompt de vente
 * (server/routes/sales-chat.ts) — prix réels, pas d'essai gratuit, démo.
 *
 * Étage 0 seulement pour une correspondance EXACTE (normalisée). Une
 * variante (« ça coûte combien ? ») descend à Gemini : on ne devine pas.
 * Plafond : quelques entrées, jamais un arbre de décision.
 */
import { normaliser } from '../lumi/raccourcis';

export interface ReponseFixe {
  id: string;
  /** Énoncés acceptés (normalisés à la volée). */
  enonces: string[];
  reponse: string;
}

export const REPONSES_FIXES: readonly ReponseFixe[] = [
  {
    id: 'prix',
    enonces: ['Combien ça coûte, Lume ?', 'Combien ça coûte ?', 'C’est quoi les prix ?', 'Vos prix ?'],
    reponse: 'Trois forfaits, en dollars canadiens, sans engagement (annuel = −15 %) : « Minimum » à 150 $/mois (3 utilisateurs, 1 bureau), « Scale » à 340 $/mois (10 utilisateurs, 2 bureaux, avec l’assistant IA vocal, les textos, le porte-à-porte et les relances automatiques), « Autopilot » à 495 $/mois (20 utilisateurs, 5 bureaux, multi-équipes et soutien prioritaire). Pour un chiffre exact selon ton équipe, le mieux c’est une courte démo — tu veux que je t’aide à en réserver une ?',
  },
  {
    id: 'factures-devis',
    enonces: ['Est-ce que ça gère mes factures et devis ?', 'Ça gère les factures et les devis ?', 'Est-ce que Lume fait la facturation ?'],
    reponse: 'Oui, et au même endroit que tes clients et ta planification : soumissions envoyées par courriel avec approbation en ligne, conversion en job d’un clic, facturation automatique à la fin de la job, paiement par carte sur place ou en ligne (Stripe et PayPal), taxes TPS/TVQ, relances de factures automatiques. Ça te sert dans quel métier ? Je peux te dire comment ça se passe concrètement.',
  },
  {
    id: 'remplace-quoi',
    enonces: ['Ça remplace quoi dans mon entreprise ?', 'Ça remplace quoi ?', 'Ça sert à quoi ?'],
    reponse: 'Le cahier de rendez-vous, les soumissions faites à la main, le fichier Excel des clients, les relances de factures qu’on oublie et les textos perdus : tout ça vit dans Lume — clients, soumissions, jobs et calendrier, paiements, pipeline de leads, textos et courriels, accès mobile. Un client, Vision Lavage, dit avoir économisé l’équivalent d’un salaire de secrétaire à temps plein. Tu fais quoi comme service ?',
  },
];

const INDEX = new Map<string, ReponseFixe>();
for (const r of REPONSES_FIXES) for (const e of r.enonces) INDEX.set(normaliser(e).join(' '), r);

/** La réponse fixe pour cet énoncé, ou null (Gemini répond). */
export function reponseFixePour(enonce: string): ReponseFixe | null {
  return INDEX.get(normaliser(enonce).join(' ')) ?? null;
}
