/**
 * Robustesse des conversations de Lumi — les types partagés (purs : ni base, ni réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Même contrat que les tests critiques (`../critiques/types.mts`) : un test dit
 * CE QU'IL FAIT, ce qu'il a OBSERVÉ, ce qu'il observerait SI LE DÉFAUT EXISTAIT,
 * et rend PASS, FAIL, NON COUVERT ou A RELIRE avec la preuve.
 *
 * Ce qui change : cinq comptes au lieu de deux (une famille = un compte
 * propriétaire, pour tenir dans la limite de 60 tours par heure et par
 * personne), des flux que la batterie COUPE elle-même, et deux sessions du même
 * compte pour le « web + mobile ».
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Echange, Proposition } from '../critiques/jugement.mts';
import type { Issue, Preuve, Verdict } from '../critiques/types.mts';
import type { Faits } from './faits.mts';

export type { Issue, Preuve, Verdict };

/** Tout ce que la batterie écrit pour vrai porte ce marqueur (tâches seulement) ; le ménage le retire par suppression douce. */
export const MARQUEUR_ROB = '[ROB]';

export type Compte = 'proprio1' | 'proprio2' | 'proprio3' | 'proprio4' | 'technicien';
export type CompteProprietaire = Exclude<Compte, 'technicien'>;
export const COMPTES: readonly Compte[] = ['proprio1', 'proprio2', 'proprio3', 'proprio4', 'technicien'];

/** La phase 4 de la mission, mot pour mot. Chaque ligne a au moins un test, ou un NON COUVERT argumenté (vérifié par un test). */
export const LIGNES_PHASE4: readonly string[] = [
  'Conversations longues (50+ tours) : pas de perte de contexte critique, pas d\'explosion de coût, gestion propre de la limite de contexte',
  'Références implicites : « le deuxième », « lui », « fais pareil pour l\'autre »',
  'L\'utilisateur change d\'idée en plein milieu d\'une action, annule, reformule',
  'Reload de page, perte réseau, fermeture de l\'app pendant une réponse en streaming → la conversation reprend proprement, aucune action exécutée à moitié',
  'Même utilisateur sur web + mobile en même temps',
  'Messages vides, très longs, collages de texte, emojis, double envoi',
  'Vocal : silence, bruit, phrase coupée, accent québécois, transcription erronée → Lumi demande une confirmation au lieu d\'agir sur une mauvaise transcription',
  'Erreurs API (429, surcharge, timeout, réponse tronquée par max_tokens) → retry avec backoff, message clair, jamais de faux succès',
  'Échec d\'un outil → Lumi le dit, ne prétend pas que c\'est fait',
  'Toutes les valeurs possibles de stop_reason gérées correctement',
];

export interface TestRobustesse {
  id: string;
  titre: string;
  /** Ce que le test fait, en une phrase. */
  fait: string;
  /** Ce qu'il observerait si le défaut existait. */
  si_defaut: string;
  /** Lignes de la phase 4 que ce test couvre (1 à 10, voir LIGNES_PHASE4). */
  lignes: number[];
  /**
   * POST /api/lumi/chat prévus. « proprietaire » = le compte de la famille. CHAQUE envoi compte dans la limite
   * horaire du serveur, même refusé (400, 409) : le limiteur passe avant la validation.
   */
  appels: { proprietaire?: number; technicien?: number };
  /** Parmi les appels du propriétaire, ceux qui ne coûtent rien à coup sûr (refus 400, réponses sans modèle). */
  appels_sans_modele?: number;
  /** Coût d'inférence estimé, en cents ; par défaut 1,6 ¢ par appel payant du propriétaire. */
  cout_estime_cents?: number;
  /** Le test atteint EXPRÈS la limite horaire de son compte : son compte est hors du budget d'appels de la passe. */
  vise_la_limite?: boolean;
  /** Ce que le test écrit dans le bureau (tout porte le marqueur [ROB]). */
  ecrit?: string[];
  /** L'attente demandée semble fausse ou fragile : dit ici, jamais adoucie dans le verdict. */
  attente_discutable?: string;
  /** Non couvert en production par construction : la raison, et les tests hors réseau qui couvrent. */
  non_couvert?: { raison: string; couvert_par: string[] };
  executer?: (ctx: Contexte) => Promise<Issue>;
}

export interface Famille {
  nom: string;
  titre: string;
  /** Ce que la famille doit prouver. */
  prouve: string;
  /** Le compte propriétaire qui joue la famille (autre compte avec --proprietaire). */
  compte: CompteProprietaire;
  /** La famille lit les fiches du jeu [EVAL]. */
  besoin_jeu_eval?: boolean;
  /** La famille ne prouve rien en palier dégradé (fenêtre d'historique de 6 messages, modèle de repli) : NON COUVERT sans --malgre-palier. */
  besoin_palier_normal?: boolean;
  tests: TestRobustesse[];
}

export interface Resultat extends Issue {
  id: string;
  famille: string;
  titre: string;
  fait: string;
  si_defaut: string;
  lignes: number[];
  attente_discutable?: string;
  couvert_par?: string[];
  duree_ms: number;
}

/** Une session d'un compte de test. Deux sessions du même compte = deux jetons (« web » et « mobile »). */
export interface Session {
  compte: Compte;
  courriel: string;
  userId: string;
  jeton: string;
  rafraichir: string;
  appareil: 'web' | 'mobile';
}

/** Où la batterie coupe elle-même la connexion : au premier événement de ce genre, ou après un délai. */
export type Coupure = { apres: 'entete' | 'texte' | 'carte' | 'recu' } | { apres_ms: number };

/** Un échange avec ce que la batterie en a fait (coupé ou non) et ce que le serveur dit de la limite horaire. */
export interface Tour extends Echange {
  /** La batterie a coupé la connexion elle-même. */
  coupe: boolean;
  /** Le flux a porté « done » ou « error ». */
  termine: boolean;
  /** Ce qu'il reste dans la limite horaire de Lumi d'après le serveur (en-tête X-RateLimit-Remaining quand le plafond annoncé est 60) ; null sinon. */
  restant: number | null;
  /** L'attente annoncée par un 429, en secondes : en-tête Retry-After, sinon le délai écrit dans le message ; null si rien. */
  retry_after: number | null;
  /** La réponse était un flux d'événements. */
  est_flux: boolean;
}

export interface OptionsTour {
  conversation_id?: string | null;
  langue?: 'fr' | 'en';
  /** D'où vient le message (mesure du serveur) : « voix » pour une dictée. */
  origine?: 'texte' | 'voix' | 'repli' | 'suggestion' | 'lien';
  couper?: Coupure;
  /** Envois simultanés : sans le délai minimal entre deux appels du même compte. */
  sans_cadence?: boolean;
}

/** Un message tel que GET /api/lumi/conversations/:id le rend à l'interface. */
export interface CarteRendue { tool_use_id: string; tool: string; args: Record<string, unknown>; statut: 'en_attente' | 'confirmee' | 'annulee' | 'echouee'; groupe?: CarteRendue[] }
export interface MessageRendu { role: 'user' | 'assistant'; text: string; tools: string[]; proposal?: CarteRendue }
export interface ConversationRendue { statut: number; messages: MessageRendu[]; brut: unknown }

/** Ce que la batterie a le droit de confirmer : rien d'autre que des tâches [ROB]. */
export interface GardeDeConfirmation {
  /** Les cartes vues dans le flux (arguments réels, identifiants démasqués). */
  vues: Proposition[];
  /** Identifiants des tâches [ROB] créées par la batterie dans cette passe. */
  ids_taches_rob: string[];
}

export interface Sante { ok: boolean; uptime_s: number | null; demarre_le_ms: number | null }

export interface ClientLumi {
  /** Un tour de Lumi (POST /api/lumi/chat). Attend et reprend sur une limite à la minute ; lève LimiteAtteinte sur la limite horaire ; lève FluxInterrompu si le flux se ferme sans « done » ni « error » alors que la batterie ne l'a pas coupé. */
  demander(s: Session, message: string, o?: OptionsTour): Promise<Tour>;
  /** POST /api/lumi/chat avec un corps quelconque, SANS aucune reprise : la réponse telle quelle (400, 409, 429…). Compte dans le budget, sauf `hors_budget`. */
  envoyerBrut(s: Session, corps: Record<string, unknown>, o?: { couper?: Coupure; sans_cadence?: boolean; hors_budget?: boolean }): Promise<Tour>;
  /** Annule une carte en attente (aucune écriture). */
  annuler(s: Session, conversationId: string, toolUseId: string): Promise<Tour>;
  /** Confirme une carte — seulement si TOUTES les écritures en attente de la conversation sont des tâches [ROB]. Sinon lève ConfirmationRefusee, sans rien envoyer. */
  confirmer(s: Session, conversationId: string, toolUseId: string, garde: GardeDeConfirmation, o?: { couper?: Coupure; sans_cadence?: boolean }): Promise<Tour>;
  /** Même garde-fou, mais en deux temps : la vérification maintenant, l'envoi quand on appelle la fonction rendue (sans délai) — pour deux envois au même instant. */
  preparerConfirmation(s: Session, conversationId: string, toolUseId: string, garde: GardeDeConfirmation): Promise<() => Promise<Tour>>;
  /** La conversation telle que l'interface la recharge. */
  conversation(s: Session, conversationId: string): Promise<ConversationRendue>;
  /** Un appel d'API quelconque, à l'identité du compte. */
  appel(s: Session, methode: 'GET' | 'POST', chemin: string, o?: { corps?: unknown }): Promise<{ statut: number; json: unknown; texte: string }>;
  /** POST /api/agent/transcribe (dictée). */
  transcrire(s: Session, audioBase64: string, mime: 'audio/wav'): Promise<{ statut: number; json: unknown; texte: string }>;
  /** GET /api/health : depuis quand le serveur tourne (un redéploiement remet ce compteur à zéro). */
  sante(): Promise<Sante>;
  /** POST /api/lumi/chat déjà faits dans cette passe, par compte. */
  compteurs(): Record<Compte, number>;
  /** Ce qu'il reste dans l'heure d'après le dernier en-tête du serveur, par compte (null : jamais vu). */
  restants(): Record<Compte, number | null>;
  /** Conversations ouvertes par la passe (elles restent en base : les supprimer serait une suppression dure). */
  conversations(): string[];
}

export interface Contexte {
  api: string;
  org: string;
  nomOrg: string;
  fuseau: string;
  /** SELECT en lecture seule (API de gestion, `read_only: true`) : les faits indépendants. */
  sql<T = Record<string, unknown>>(requete: string): Promise<T[]>;
  /** Clé de service : seulement pour le mode Lumi des comptes et les tâches [ROB]. */
  admin: SupabaseClient;
  lumi: ClientLumi;
  /** Les faits du jeu [EVAL] de CE bureau (fiche des faits + identifiants dérivés). */
  faits: Faits;
  /** La session du compte propriétaire de la famille en cours. */
  proprietaire(): Session;
  /** Une SECONDE session du même compte (autre jeton) : le « mobile ». Ouverte à la demande, fermée à la fin. */
  secondeSession(): Promise<Session>;
  /** La session du technicien (compte dédié au test de la limite horaire). Ouverte à la demande. */
  technicien(): Promise<Session>;
  /** Crée une tâche [ROB] avec la clé de service ; rend son identifiant. */
  creerTacheRob(titre: string): Promise<{ id: string; titre: string }>;
  /** Identifiants des tâches [ROB] créées par la batterie dans cette passe. */
  idsTachesRob(): string[];
  /** Conversations de TOUTE la batterie : ce lancement et les précédents du même rapport. */
  conversationsDeLaBatterie(): string[];
  /** Suffixe unique de la passe (titres des tâches). */
  nonce: string;
  debut: Date;
  /** Le jeu [EVAL] est présent dans le bureau. */
  jeuPresent: boolean;
  /** Palier de crédits du bureau au début de la famille (normal, econome, restreint, epuise) ; null si illisible. */
  palier: string | null;
  dire(texte: string): void;
  attendre(ms: number): Promise<void>;
}
