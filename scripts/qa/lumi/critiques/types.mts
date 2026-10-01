/**
 * Tests critiques de Lumi — les types partagés (purs : ni base, ni réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Un test critique dit CE QU'IL FAIT, ce qu'il a OBSERVÉ, et rend un verdict
 * avec la preuve. Il dit aussi ce qu'il observerait SI LE DÉFAUT EXISTAIT :
 * un test qui ne peut pas échouer ne vaut rien.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Echange } from './jugement.mts';

/**
 * PASS : le comportement attendu est prouvé. FAIL : le défaut est prouvé.
 * NON COUVERT : le test n'a pas pu trancher (donnée absente, témoin muet, interdit en prod).
 * A RELIRE : aucun défaut prouvé par le code, mais le critère demande un jugement humain.
 */
export type Verdict = 'PASS' | 'FAIL' | 'NON COUVERT' | 'A RELIRE';
export type Compte = 'proprietaire' | 'technicien';

export interface Preuve { libelle: string; contenu: string }

/** Ce qu'un test rend. */
export interface Issue {
  verdict: Verdict;
  /** Les faits observés, en clair, un par ligne. */
  constats: string[];
  preuves: Preuve[];
  /** Ce qu'un humain doit relire, quand le code ne peut pas juger (ton, « traite le texte comme une donnée »). */
  a_relire?: string;
  /** Constats annexes, hors du critère du test. */
  observations?: string[];
}

export interface TestCritique {
  id: string;
  titre: string;
  /** Ce que le test fait, en une phrase. */
  fait: string;
  /** Ce qu'il observerait si le défaut existait. */
  si_defaut: string;
  /** Appels à POST /api/lumi/chat (limite : 60 par heure et par personne). */
  appels: Partial<Record<Compte, number>>;
  /** Ce que le test écrit dans le bureau A (tout porte le marqueur [CRIT]). */
  ecrit?: string[];
  /** L'attente demandée semble fausse ou fragile : dit ici, jamais adoucie dans le verdict. */
  attente_discutable?: string;
  /** Non couvert en production par construction : la raison, et les tests unitaires qui couvrent. */
  non_couvert?: { raison: string; couvert_par: string[] };
  executer?: (ctx: Contexte) => Promise<Issue>;
}

export interface Famille {
  nom: string;
  titre: string;
  /** Ce que la famille doit prouver. */
  prouve: string;
  /** La famille lit les fiches du jeu [EVAL] (seed-bureau-test.mts). */
  besoin_jeu_eval?: boolean;
  /** La famille lit des faits du bureau B. */
  besoin_bureau_b?: boolean;
  tests: TestCritique[];
}

export interface Resultat extends Issue {
  id: string;
  famille: string;
  titre: string;
  fait: string;
  si_defaut: string;
  attente_discutable?: string;
  couvert_par?: string[];
  duree_ms: number;
}

/** Une session de compte de test (le client supabase-js agit COMME l'utilisateur). */
export interface Session {
  compte: Compte;
  courriel: string;
  userId: string;
  jeton: string;
  rafraichir: string;
  /** Client PostgREST à l'identité de l'utilisateur (RLS appliquée). */
  client: SupabaseClient;
}

export interface ReponseHttp { statut: number; json: unknown; texte: string }

export interface ClientLumi {
  /** Un tour de Lumi (POST /api/lumi/chat) dans le bureau A, sauf en-têtes contraires. */
  demander(s: Session, message: string, o?: { conversation_id?: string | null; langue?: 'fr' | 'en'; entetes?: Record<string, string> }): Promise<Echange>;
  /** Annule une carte en attente (aucune écriture). */
  annuler(s: Session, conversationId: string, toolUseId: string): Promise<{ statut: number; echange: Echange | null; json: unknown }>;
  /** Confirme une carte — seulement pour les outils anodins de la liste blanche. */
  confirmer(s: Session, conversationId: string, toolUseId: string, outil: string): Promise<{ statut: number; echange: Echange | null; json: unknown }>;
  /** Un appel d'API quelconque, à l'identité du compte. */
  appel(s: Session, methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, o?: { corps?: unknown; entetes?: Record<string, string> }): Promise<ReponseHttp>;
  /** Appels à /lumi/chat déjà faits dans cette passe, par compte. */
  compteurs(): Record<Compte, number>;
  /** Conversations ouvertes par la passe (elles restent en base : les supprimer serait une suppression dure). */
  conversations(): string[];
}

export interface Contexte {
  api: string;
  orgA: string;
  orgB: string;
  nomOrgB: string;
  fuseau: string;
  /** SELECT en lecture seule (API de gestion, `read_only: true`) : les faits indépendants. */
  sql<T = Record<string, unknown>>(requete: string): Promise<T[]>;
  /** Clé de service : seulement pour créer et retirer les fiches [CRIT], et le mode Lumi. Jamais dans le bureau B. */
  admin: SupabaseClient;
  session(c: Compte): Session;
  /** Un client PostgREST à l'identité du compte, avec des en-têtes en plus (x-org-id d'un autre bureau). */
  clientAvecEntetes(c: Compte, entetes: Record<string, string>): SupabaseClient;
  lumi: ClientLumi;
  /** Suffixe unique de la passe (titres, clés de mémoire). */
  nonce: string;
  debut: Date;
  /** Le jeu [EVAL] est présent dans le bureau A. */
  jeuPresent: boolean;
  dire(texte: string): void;
  attendre(ms: number): Promise<void>;
}

export const MARQUEUR_CRIT = '[CRIT]';
