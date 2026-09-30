// Registers default mutationFns for the offline-capable write keys. These run
// when a component calls useMutation with the matching mutationKey but no
// mutationFn. Because the function lives here (not in the persisted mutation),
// a mutation queued while offline can resume after an app restart.

import type { QueryClient } from '@tanstack/react-query';

import { markJobCompleted, markJobInProgress } from '../api/jobs';
import {
  ecrireValeurs as ecrireValeursChamps,
  type ObjetChamp,
  type ValeurChamp,
} from '../api/customFields';
import { createHouseAt, logHouseEvent } from '../api/fieldSales';
import { endBreak, punchIn, punchOut, startBreak } from '../api/timesheets';
import { Job } from '@/types/db';
import { MK } from './mutationKeys';

export function registerMutationDefaults(qc: QueryClient) {
  // ── Jobs ──────────────────────────────────────────────────────────
  qc.setMutationDefaults(MK.jobStart, {
    mutationFn: (vars: { id: string }) => markJobInProgress(vars.id),
    onMutate: (vars: { id: string }) => optimisticJobStatus(qc, vars.id, 'in_progress'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  qc.setMutationDefaults(MK.jobComplete, {
    mutationFn: (vars: { id: string; notes?: string }) => markJobCompleted(vars.id, vars.notes),
    onMutate: (vars: { id: string }) => optimisticJobStatus(qc, vars.id, 'completed'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  // ── Timesheets ────────────────────────────────────────────────────
  qc.setMutationDefaults(MK.punchIn, {
    mutationFn: (vars: Parameters<typeof punchIn>[0]) => punchIn(vars),
    onSettled: () => qc.invalidateQueries({ queryKey: ['timesheet'] }),
  });
  qc.setMutationDefaults(MK.punchOut, {
    mutationFn: (vars: { entryId: string }) => punchOut(vars.entryId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['timesheet'] }),
  });
  qc.setMutationDefaults(MK.startBreak, {
    mutationFn: (vars: { entryId: string }) => startBreak(vars.entryId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['timesheet'] }),
  });
  qc.setMutationDefaults(MK.endBreak, {
    mutationFn: (vars: { entryId: string }) => endBreak(vars.entryId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['timesheet'] }),
  });

  // ── D2D ───────────────────────────────────────────────────────────
  qc.setMutationDefaults(MK.d2dLogEvent, {
    mutationFn: (vars: Parameters<typeof logHouseEvent>[0]) => logHouseEvent(vars),
    onSettled: () => qc.invalidateQueries({ queryKey: ['d2d'] }),
  });
  qc.setMutationDefaults(MK.d2dCreateHouse, {
    mutationFn: (vars: Parameters<typeof createHouseAt>[0]) => createHouseAt(vars),
    onSettled: () => qc.invalidateQueries({ queryKey: ['d2d'] }),
  });

  // ── Champs personnalisés ──────────────────────────────────────────
  // Les variables sont volontairement PLATES (pas la définition du champ) :
  // elles sont sérialisées dans AsyncStorage pour survivre à un redémarrage.
  qc.setMutationDefaults(MK.champsPersoEcrire, {
    mutationFn: (vars: EcritureChampPerso) =>
      ecrireValeursChamps(vars.objet, vars.recordId, [
        { field_id: vars.fieldId, value: vars.valeur, version: vars.version },
      ]),
    onSettled: (_d, _e, vars) => {
      const v = vars as EcritureChampPerso;
      return qc.invalidateQueries({ queryKey: ['champs-perso', v.objet, v.recordId] });
    },
  });
}

/** Ce qu'une écriture de champ personnalisé met en file, et rien de plus. */
export interface EcritureChampPerso {
  objet: ObjetChamp;
  recordId: string;
  fieldId: string;
  valeur: ValeurChamp;
  version: number | null;
}

/** Optimistically reflect a job status change so the UI updates while offline. */
function optimisticJobStatus(qc: QueryClient, id: string, status: Job['status']) {
  qc.setQueriesData<Job[]>({ queryKey: ['jobs'] }, (old) =>
    Array.isArray(old) ? old.map((j) => (j.id === id ? { ...j, status } : j)) : old,
  );
  qc.setQueriesData<Job>({ queryKey: ['jobs', id] }, (old) =>
    old ? { ...old, status } : old,
  );
}
