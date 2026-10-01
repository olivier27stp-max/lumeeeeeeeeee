/**
 * Batterie de l'agent de SUPPORT — les types partagés (purs : ni base, ni réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Même contrat que les tests critiques de Lumi (scripts/qa/lumi/critiques) :
 * un test dit CE QU'IL FAIT, ce qu'il a OBSERVÉ, et rend un verdict avec la
 * preuve. Il dit aussi ce qu'il observerait SI LE DÉFAUT EXISTAIT.
 */

/**
 * PASS : le comportement attendu est prouvé. FAIL : le défaut est prouvé.
 * NON COUVERT : le test n'a pas pu trancher (flux coupé, plafond, limite, donnée absente).
 * A RELIRE : aucun défaut prouvé par le code, mais le critère demande un humain (ton, justesse).
 */
export type Verdict = 'PASS' | 'FAIL' | 'NON COUVERT' | 'A RELIRE';

export interface Preuve { libelle: string; contenu: string }

/** Le ticket, relu par SELECT (support_tickets). */
export interface TicketLu {
  id: string;
  subject: string;
  status: string;
  escalated_at: string | null;
  escalation_reason: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  closed_at: string | null;
}

/** Un tour de l'agent de support, avec ce que la base en dit après coup. */
export interface Observation {
  /** Statut HTTP de POST /api/support/chat (0 : la requête n'a pas abouti). */
  statut: number;
  question: string;
  /** Le champ `reply` (vide quand le serveur n'en rend pas : transfert direct à un humain). */
  reponse: string;
  /** Le champ `escalated` de la réponse de l'API. */
  escalade_api: boolean;
  ticket: TicketLu | null;
  /** Corps des messages système du ticket (`escalated:email`, `escalated:slack`, `reopened:client`…). */
  systeme: string[];
  /** Étage qui a répondu, lu dans lumi_traces (0 FAQ, 4 cache, 5 centre d'aide, 6 modèle). */
  etage: number | null;
  /** Action de la trace (`faq:<id>`, `aide-directe`, `cache-semantique`, `plafond-jour`, `app`). */
  action: string | null;
  /** Outils appelés par le modèle pendant le tour (trace). */
  outils: string[];
  /** Modèle des lignes ai_usage du tour (la trace, elle, porte un nom écrit en dur dans la route). */
  modele: string | null;
  cout_cents: number | null;
  /** Appels à l'API du modèle pendant le tour (lignes ai_usage). */
  appels_modele: number;
  /** Corps de la réponse quand le statut n'est pas 200. */
  corps: unknown;
  duree_ms: number;
  debut: string;
  fin: string;
}

/** Ce qu'un tour laisse pour le tableau des coûts. */
export interface Tour {
  test: string;
  compte: string;
  user_id: string;
  question: string;
  ticket_id: string | null;
  statut: number;
  etage: number | null;
  action: string | null;
  outils: string[];
  modele: string | null;
  appels_modele: number;
  cout_cents: number | null;
  duree_ms: number;
  debut: string;
  fin: string;
}

export interface Issue {
  verdict: Verdict;
  /** Les faits observés, en clair, un par ligne. */
  constats: string[];
  preuves: Preuve[];
  /** Ce qu'un humain doit relire, quand le code ne peut pas juger. */
  a_relire?: string;
  /** Constats annexes, hors du critère du test (tutoiement dans une réponse de tarifs…). */
  observations?: string[];
  /** Le test demande l'ARRÊT de la batterie (canari : un envoi réel est parti, ou rien ne prouve le contraire). */
  arret?: string;
}

export interface TestSupport {
  id: string;
  titre: string;
  /** Ce que le test fait, en une phrase. */
  fait: string;
  /** Ce qu'il observerait si le défaut existait. */
  si_defaut: string;
  /** Appels à POST /api/support/chat. */
  appels: number;
  /** La question posée (pour le plan : l'étage prévu par le code de cette branche). */
  question?: string;
  /** `humain: true` : transfert direct, aucun assistant. */
  humain?: boolean;
  /** Langue de la question (défaut fr). */
  langue?: 'fr' | 'en';
  /** Ce que le test écrit dans le bureau. */
  ecrit?: string[];
  /** L'attente demandée semble fausse ou fragile : dit ici, jamais adoucie dans le verdict. */
  attente_discutable?: string;
  /** Non couvert en production par construction. */
  non_couvert?: { raison: string; couvert_par: string[] };
  executer?: (ctx: Contexte, s: Session) => Promise<Issue>;
}

export interface Famille {
  nom: string;
  titre: string;
  /** Ce que la famille doit prouver. */
  prouve: string;
  /** La famille lit les fiches du jeu [EVAL]. */
  besoin_jeu_eval?: boolean;
  tests: TestSupport[];
}

export interface Resultat extends Issue {
  id: string;
  famille: string;
  titre: string;
  fait: string;
  si_defaut: string;
  compte: string | null;
  attente_discutable?: string;
  couvert_par?: string[];
  duree_ms: number;
}

/** Une session de compte de test. */
export interface Session {
  /** « proprio1 », « tech »… */
  cle: string;
  courriel: string;
  userId: string;
  jeton: string;
  rafraichir: string;
}

/** Ce que rend POST /api/support/chat. */
export interface ReponseChat {
  statut: number;
  reponse: string | null;
  escalade: boolean;
  ticket_id: string | null;
  ticket_statut: string | null;
  corps: unknown;
  duree_ms: number;
  debut: string;
  fin: string;
}

export interface ClientSupport {
  /** Un tour de l'agent de support (POST /api/support/chat). Jamais rejoué après un échec de réseau : un second envoi ouvrirait un second ticket. */
  demander(s: Session, message: string, o?: { humain?: boolean; ticketId?: string }): Promise<ReponseChat>;
  /** Ferme un ticket de la batterie (POST /api/support/:id/close). */
  fermer(s: Session, ticketId: string): Promise<number>;
  /** Appels à /support/chat déjà faits dans cette passe, par compte. */
  compteurs(): Record<string, number>;
}

/**
 * Ce qu'un test a en main. Ni clé de service ni client de l'API : un test ne peut que poser une
 * question (`poser`) et lire la base (`sql`, en lecture seule).
 */
export interface Contexte {
  org: string;
  /** SELECT en lecture seule (API de gestion, `read_only: true`) : les faits indépendants. */
  sql<T = Record<string, unknown>>(requete: string): Promise<T[]>;
  /** Un tour complet : la question, puis ce que la base en dit (ticket, messages système, trace, grand livre). */
  poser(s: Session, test: string, question: string, o?: { humain?: boolean; ticketId?: string }): Promise<Observation>;
  /** Les tours de la passe (ce lancement et, si le rapport est complété, les précédents) — le tableau vivant du lanceur : le relevé des coûts le met à jour sur place. */
  tours(): Tour[];
  /** Nom du forfait du bureau (table plans), ou null sans abonnement. */
  forfait: string | null;
  /** L'instant présent, dans l'horloge de la BASE (ISO) : c'est avec elle que les lignes écrites par le serveur sont datées. */
  maintenant(): string;
  dire(texte: string): void;
  attendre(ms: number): Promise<void>;
}

/** Préfixe des messages que la batterie peut signer sans changer ce qui est éprouvé (le canari). */
export const MARQUEUR_SUP = '[SUP]';
