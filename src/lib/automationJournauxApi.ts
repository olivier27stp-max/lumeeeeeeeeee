/* ═══════════════════════════════════════════════════════════════
   Ce qu'une automatisation a fait — Historique, Journaux, modifications.

   Deux vues, deux rôles :
   · l'HISTORIQUE, pour le propriétaire : une ligne par passage d'un client
     (qui, quand, quelle étape, le résultat en clair) ;
   · les JOURNAUX, le détail technique : l'événement déclencheur, la
     décision (code d'issue), le résultat de chaque étape, l'erreur exacte,
     la durée, la clé d'exécution — result_error, result_data, action_config,
     duration_ms, trigger_event, execution_key.

   Les lectures passent par le SERVEUR (`/api/automations/rules/historique`,
   `/journaux`, `/modifications`), qui filtre, cherche et pagine en base,
   avec le jeton de l'utilisateur (la RLS s'applique). Avant, le navigateur
   lisait PostgREST et s'arrêtait à 200 lignes sans le dire (D-15), sans
   recherche ni filtre par client ou par date (D-13).

   Les libellés (raisons, statuts, actions) vivent dans `automationIssues.ts`
   — réexportés ici pour les écrans et les tests qui les lisaient déjà.
   ═══════════════════════════════════════════════════════════════ */

import { interfaceEnFrancais } from './champs/messages';
import { lireRoute, type Periode } from './automationStatsApi';
import type { FiltreStatut, PeriodeJours } from './automationIssues';

export { libelleAction, libelleStatut, raisonLisible, raisonEchecListe, motifSaut } from './automationIssues';

/** Sur combien de jours les journaux sont gardés, donc lisibles (purge `run_retention_logs`). */
export const FENETRE_JOURS = 90;

// ── Ce que le serveur rend ──────────────────────────────────

/** La fiche concernée (facture, devis, job, rendez-vous, opportunité). */
export interface FicheLiee {
  type: string;
  id: string;
  numero: string | null;
  titre: string | null;
  /** Chemin de la fiche dans l'application, ou `null` s'il n'y a pas d'écran pour elle. */
  lien: string | null;
}

export interface LigneJournal {
  /** Unique à l'écran : l'identifiant de la ligne du journal, ou « tâche:issue » pour un état de la file. */
  id: string;
  source: 'journal' | 'tache';
  /** Le code d'issue (voir `automationIssues.ts`) et la catégorie comptée. */
  issue: string;
  categorie: string;
  quand: string;
  rule_id: string;
  rule_nom: string | null;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  /** Nom du client, résolu par le serveur — la table ne le porte pas. */
  client_nom: string | null;
  task_id: string | null;
  step_id: string | null;
  etape_position: number | null;
  etape_nom: string | null;
  action_type: string;
  trigger_event: string | null;
  result_error: string | null;
  /**
   * Ce qui est RÉELLEMENT parti : destinataire, objet, corps du message.
   *
   * La colonne était lue en base mais absente de ce type, donc jamais
   * affichée. L'entrepreneur ne pouvait pas vérifier que ses variables
   * avaient été remplacées — QA du 2026-09-25 (P1-4).
   */
  result_data?: Record<string, unknown> | null;
  /** La configuration de l'action au moment de l'envoi (le message qui DEVAIT partir, pour un échec). */
  action_config?: Record<string, unknown> | null;
  duration_ms: number | null;
  execution_key: string | null;
  /** L'état de la tâche de la file, quand la ligne en vient ou y est rattachée. */
  tache: { status: string; execute_at: string; attempts: number; last_error: string | null; completed_at: string | null } | null;
  fiche: FicheLiee | null;
}

export interface PageJournal {
  periode: Periode;
  total: number;
  page: number;
  par_page: number;
  /** Les types d'action présents sur la période (pour le filtre). */
  actions: string[];
  lignes: LigneJournal[];
}

export interface EvenementPassage {
  source: 'journal' | 'tache';
  id: string;
  issue: string;
  categorie: string;
  quand: string;
  action_type: string;
  step_id: string | null;
  etape_position: number | null;
  etape_nom: string | null;
  en_file: boolean;
  trigger_event: string | null;
  /** La phrase du moteur (motif d'un envoi ignoré, erreur, motif d'annulation). */
  detail: string | null;
  execute_at: string | null;
  attempts: number | null;
}

export interface Passage {
  cle: string;
  rule_id: string;
  rule_nom: string | null;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  client_nom: string | null;
  debut: string;
  fin: string;
  /** Une étape est encore en file : un envoi est à venir. */
  en_file: boolean;
  /** Faux : l'événement a été écarté avant d'entrer (hors ciblage…). */
  declenche: boolean;
  resultat: string;
  evenements: EvenementPassage[];
  fiche: FicheLiee | null;
}

export interface PagePassages {
  periode: Periode;
  total: number;
  page: number;
  par_page: number;
  passages: Passage[];
}

export interface LigneModification {
  id: string;
  rule_id: string;
  auteur_id: string | null;
  auteur_nom: string | null;
  origine: 'utilisateur' | 'lumi' | 'systeme';
  action: string;
  champs: string[];
  resume_fr: string;
  resume_en: string;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  created_at: string;
}

export interface PageModifications {
  total: number;
  page: number;
  par_page: number;
  lignes: LigneModification[];
}

export interface FiltresLecture {
  /** Absent : tout le bureau. */
  ruleId?: string | null;
  jours: PeriodeJours;
  /** Dates civiles (AAAA-MM-JJ), dans le fuseau de l'entreprise. */
  du?: string | null;
  au?: string | null;
  statut?: FiltreStatut | null;
  action?: string | null;
  clientId?: string | null;
  /** Recherche par nom de client. */
  recherche?: string | null;
  page?: number;
  parPage?: number;
}

// ── Lectures ────────────────────────────────────────────────

const parametresDe = (f: FiltresLecture) => ({
  rule_id: f.ruleId, jours: f.jours, du: f.du, au: f.au, statut: f.statut, action: f.action,
  client_id: f.clientId, q: f.recherche?.trim(), page: f.page, par_page: f.parPage,
});

/** Les Journaux : le détail technique, filtré et paginé par le serveur, avec le total. */
export async function lireJournaux(f: FiltresLecture): Promise<PageJournal> {
  const page = await lireRoute<PageJournal>('/api/automations/rules/journaux', parametresDe(f),
    interfaceEnFrancais() ? 'Les journaux n’ont pas pu être lus.' : 'Logs could not be read.');
  // Une même tâche peut donner deux lignes (reportée, puis annulée) : la clé d'écran les distingue.
  return { ...page, lignes: page.lignes.map((l) => (l.source === 'tache' ? { ...l, id: `${l.id}:${l.issue}` } : l)) };
}

/** L'Historique : une ligne par passage d'un client, filtré et paginé par le serveur, avec le total. */
export function lireHistorique(f: FiltresLecture): Promise<PagePassages> {
  return lireRoute<PagePassages>('/api/automations/rules/historique', parametresDe({ ...f, action: null }),
    interfaceEnFrancais() ? 'L’historique n’a pas pu être lu.' : 'History could not be read.');
}

/** Qui a modifié quoi dans une automatisation, la modification la plus récente d'abord. */
export function lireModifications(ruleId: string, page = 1): Promise<PageModifications> {
  return lireRoute<PageModifications>('/api/automations/rules/modifications', { rule_id: ruleId, page },
    interfaceEnFrancais() ? 'Les modifications n’ont pas pu être lues.' : 'Changes could not be read.');
}
