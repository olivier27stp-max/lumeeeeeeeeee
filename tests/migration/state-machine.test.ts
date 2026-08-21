// Machine à états de la migration assistée : les transitions interdites par la
// spec doivent être réellement bloquées, et l'import final n'a qu'une porte.

import { describe, it, expect } from 'vitest';
import { assertTransition, canTransition, InvalidTransitionError, isTerminal, canStartFinalImport } from '../../server/lib/migration/state-machine';
import { MIGRATION_STATUSES } from '../../server/lib/migration/types';

describe('machine à états — transitions valides', () => {
  it('suit le parcours nominal complet', () => {
    const path = [
      'draft', 'invitation_sent', 'waiting_for_files', 'files_uploaded', 'parsing', 'mapping',
      'human_review', 'ready_for_test', 'testing', 'test_review', 'waiting_for_approval',
      'approved', 'ready_for_final_import', 'importing', 'post_import_validation', 'completed',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it('tolère le no-op (même statut)', () => {
    expect(canTransition('mapping', 'mapping')).toBe(true);
  });

  it('permet les retours contrôlés (corrections)', () => {
    expect(canTransition('test_review', 'mapping')).toBe(true);
    expect(canTransition('waiting_for_approval', 'test_review')).toBe(true);
  });
});

describe('machine à états — transitions interdites (spec)', () => {
  it('files_uploaded ne saute jamais à completed', () => {
    expect(canTransition('files_uploaded', 'completed')).toBe(false);
    expect(() => assertTransition('files_uploaded', 'completed')).toThrow(InvalidTransitionError);
  });

  it("l'import (importing) n'est accessible que depuis ready_for_final_import", () => {
    for (const s of MIGRATION_STATUSES) {
      if (s === 'importing' || s === 'ready_for_final_import') continue;
      expect(canTransition(s, 'importing'), `${s} → importing devrait être interdit`).toBe(false);
    }
    expect(canStartFinalImport('ready_for_final_import')).toBe(true);
    expect(canStartFinalImport('approved')).toBe(false);
    expect(canStartFinalImport('waiting_for_approval')).toBe(false);
  });

  it('une migration completed ne retourne jamais en arrière (sauf rollback)', () => {
    for (const s of MIGRATION_STATUSES) {
      if (s === 'completed' || s === 'rolled_back') continue;
      expect(canTransition('completed', s), `completed → ${s}`).toBe(false);
    }
  });

  it('cancelled ne repart que par action administrative (draft)', () => {
    for (const s of MIGRATION_STATUSES) {
      if (s === 'cancelled' || s === 'draft') continue;
      expect(canTransition('cancelled', s), `cancelled → ${s}`).toBe(false);
    }
    expect(canTransition('cancelled', 'draft')).toBe(true);
  });

  it('statuts terminaux cohérents', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('mapping')).toBe(false);
  });
});
