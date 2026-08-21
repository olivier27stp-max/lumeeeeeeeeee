// Machine à états de la migration assistée. Toute transition de statut passe
// par assertTransition côté serveur — jamais de write direct du statut ailleurs.

import type { MigrationStatus } from './types';
import { TERMINAL_STATUSES } from './types';

/** Table de vérité : statut → statuts atteignables. */
const TRANSITIONS: Record<MigrationStatus, MigrationStatus[]> = {
  draft: ['invitation_sent', 'cancelled'],
  invitation_sent: ['waiting_for_files', 'cancelled'],
  waiting_for_files: ['files_uploaded', 'cancelled'],
  files_uploaded: ['parsing', 'waiting_for_files', 'cancelled'],
  parsing: ['mapping', 'files_uploaded', 'failed', 'cancelled'],
  mapping: ['human_review', 'waiting_for_client', 'ready_for_test', 'parsing', 'cancelled'],
  human_review: ['waiting_for_client', 'mapping', 'ready_for_test', 'cancelled'],
  waiting_for_client: ['human_review', 'mapping', 'ready_for_test', 'cancelled'],
  ready_for_test: ['testing', 'mapping', 'human_review', 'cancelled'],
  testing: ['test_review', 'failed', 'cancelled'],
  test_review: ['waiting_for_approval', 'mapping', 'human_review', 'ready_for_test', 'cancelled'],
  waiting_for_approval: ['approved', 'test_review', 'mapping', 'human_review', 'cancelled'],
  approved: ['ready_for_final_import', 'waiting_for_approval', 'cancelled'],
  ready_for_final_import: ['importing', 'approved', 'cancelled'],
  importing: ['post_import_validation', 'failed'],
  post_import_validation: ['completed', 'completed_with_warnings', 'failed'],
  failed: ['rolled_back', 'ready_for_final_import', 'mapping', 'cancelled'],
  completed: ['rolled_back'],
  completed_with_warnings: ['rolled_back'],
  rolled_back: ['mapping', 'cancelled'],
  // Une migration annulée ne repart que par action administrative explicite.
  cancelled: ['draft'],
};

export function canTransition(from: MigrationStatus, to: MigrationStatus): boolean {
  if (from === to) return true; // no-op toléré (idempotence des handlers)
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export class InvalidTransitionError extends Error {
  readonly from: MigrationStatus;
  readonly to: MigrationStatus;
  constructor(from: MigrationStatus, to: MigrationStatus) {
    super(`Transition de statut invalide: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: MigrationStatus, to: MigrationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(status: MigrationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Statuts depuis lesquels l'import final peut être lancé (approbation déjà exigée en amont). */
export function canStartFinalImport(status: MigrationStatus): boolean {
  return status === 'ready_for_final_import';
}

/** Le portail client est ouvert (lecture) tant que la migration n'est pas fermée/annulée. */
export function isPortalReadable(status: MigrationStatus): boolean {
  return status !== 'cancelled';
}
