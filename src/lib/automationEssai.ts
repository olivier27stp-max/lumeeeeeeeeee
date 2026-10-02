/* ═══════════════════════════════════════════════════════════════
   « TESTER AVEC UN CLIENT » — le contrat, partagé par le serveur
   (server/lib/automations-essai.ts) et le navigateur.

   Une SIMULATION : le parcours est suivi étape par étape pour UN client
   choisi, chaque message est rendu avec SES vraies valeurs, chaque condition
   est jugée sur SA fiche — et RIEN n'est envoyé, RIEN n'est écrit, aucune
   action n'est exécutée (ni étiquette posée, ni tâche créée).

   Types seulement : aucun import.
   ═══════════════════════════════════════════════════════════════ */

export type IssueEssai =
  /** L'étape s'exécuterait ; pour un message, `rendu` porte le texte exact. */
  | 'partirait'
  /** L'étape serait ignorée pour ce client ; `raison` dit pourquoi. */
  | 'ignoree'
  /** Une attente : le parcours reprend après. */
  | 'attente'
  /** Une condition : `branche` dit laquelle ce client prendrait. */
  | 'condition'
  /** « Arrêter ici ». */
  | 'fin';

/** Ce client passe-t-il par cette étape ? `peut_etre` : une condition en amont n'a pas pu être jugée — les deux branches sont montrées. */
export type SurLeChemin = 'oui' | 'non' | 'peut_etre';

export interface RenduEssai {
  canal: 'sms' | 'email';
  /** Le numéro ou l'adresse où le message partirait ; `null` quand le client n'en a pas. */
  destinataire: string | null;
  /** Courriel : l'objet rendu. */
  objet?: string;
  /** Le message tel que le client le lirait (un courriel : son texte, sans balises). */
  texte: string;
  /** Courriel : le corps rendu, en HTML (valeurs échappées). */
  html?: string;
  /** Texto : le nombre de SMS facturés pour CE texte. */
  sms?: number;
}

export interface EtapeEssai {
  etape_id: string | null;
  /** Rang de l'étape dans le parcours (1 = la première). */
  rang: number;
  /** Ce que fait l'étape, en clair : « Envoyer un texto », « Attendre 3 jours ». */
  libelle: string;
  issue: IssueEssai;
  sur_le_chemin: SurLeChemin;
  rendu?: RenduEssai;
  /** Les champs de texte d'une action interne, rendus (titre d'une tâche, texte d'une note…). */
  textes?: Record<string, string>;
  /** Pourquoi l'étape serait ignorée, ou ce qu'il faut savoir d'elle. */
  raison?: string;
  /** Condition : la branche prise ; absente quand elle n'a pas pu être jugée. */
  branche?: 'alors' | 'sinon';
  /** Variables écrites dans le message qui n'ont aucune valeur pour ce client (elles partent vides). */
  variables_vides?: string[];
}

export interface ResultatEssai {
  /** Toujours vrai : rien n'est envoyé, rien n'est écrit. */
  simulation: true;
  client: { id: string; nom: string };
  /** La fiche utilisée pour le déclencheur (la facture, le devis… le plus récent du client) ; `null` s'il n'en a pas. */
  fiche: { type: string; id: string; libelle: string } | null;
  /** Le client est-il ciblé ? Sinon, pourquoi (la phrase du journal). */
  ciblage: { cible: boolean; raison: string | null };
  etapes: EtapeEssai[];
  /** Ce qu'il faut savoir avant de se fier à l'essai. */
  avertissements: string[];
}

export interface BrouillonEssai {
  trigger_event?: string;
  conditions?: Record<string, unknown>;
  steps?: unknown[];
  actions?: unknown[];
  delay_seconds?: number;
}

export interface DemandeEssai {
  client_id: string;
  /**
   * Le parcours TEL QU'À L'ÉCRAN (modifications non enregistrées comprises).
   * Absent : la version enregistrée de la règle.
   */
  brouillon?: BrouillonEssai;
}
