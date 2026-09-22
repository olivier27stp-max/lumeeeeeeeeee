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

/**
 * Vocabulaire du MÉTIER de l'utilisateur. Le routeur classe parfois
 * `hors_scope` une vraie question d'affaires — mesuré le 2026-09-22 sur
 * « est-ce que je devrais arrêter de faire du lavage de gouttières », rendue
 * à 0,95 de confiance. Or c'est précisément la question où Lumi a donné sa
 * meilleure réponse : il a trouvé le service, cité 1 910 $ au cent près et
 * refusé de conclure sur un seul job.
 *
 * Un court-circuit qui remplace CETTE réponse par un refus générique coûte
 * bien plus que les 2 ¢ qu'il économise. Dès qu'un mot du métier apparaît,
 * le modèle reprend la main.
 */
const MOTS_METIER = [
  // ce qu'on vend et ce qu'on fait
  'client', 'clients', 'job', 'jobs', 'travail', 'contrat', 'service', 'services',
  'devis', 'soumission', 'facture', 'factures', 'paiement', 'paiements',
  'revenu', 'revenus', 'chiffre', 'profit', 'marge', 'rentable', 'rentabilite',
  'prix', 'tarif', 'cout', 'couts', 'depense', 'depenses',
  // le terrain
  'lavage', 'vitres', 'toiture', 'paysagement', 'gouttiere', 'gouttieres',
  'deneigement', 'entretien', 'nettoyage', 'installation', 'reparation',
  // les gens et le temps
  'employe', 'employes', 'technicien', 'techniciens', 'gars', 'equipe',
  'horaire', 'calendrier', 'semaine', 'mois', 'journee', 'rendez',
  // les verbes d'analyse qui trahissent une question d'affaires
  'devrais', 'devrait', 'vaut', 'rapporte', 'rapportent', 'perds', 'perd',
  // l'argent, sous toutes ses formes courantes
  'argent', 'gagne', 'gagner', 'gagnes', 'paye', 'payer', 'facture', 'encaisse',
  'du', 'doit', 'doivent', 'retard', 'retards', 'impaye', 'impayes',
];

/**
 * Un NOM PROPRE (mot capitalisé au milieu de la phrase) trahit presque
 * toujours une question sur un client, un employé ou un job précis — donc
 * sur les données. « est-ce que je fais de l'argent avec Tremblay » n'a
 * aucun mot du métier, mais « Tremblay » suffit à savoir que le modèle doit
 * répondre. On ignore le premier mot : une phrase commence par une majuscule.
 */
function contientNomPropre(message: string): boolean {
  const mots = message.trim().split(/\s+/).slice(1);
  return mots.some((m) => /^[A-ZÀ-Þ][a-zà-ÿ]{2,}$/.test(m));
}

/** true si l'énoncé parle de Lume, du compte, OU du métier : jamais hors-sujet. */
export function mentionneLume(message: string): boolean {
  const mots = new Set(normaliser(message));
  if (contientNomPropre(message)) return true;
  return MOTS_LUME.some((m) => mots.has(m)) || MOTS_METIER.some((m) => mots.has(m));
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
