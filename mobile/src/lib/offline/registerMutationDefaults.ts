// Registers default mutationFns for the offline-capable write keys. These run
// when a component calls useMutation with the matching mutationKey but no
// mutationFn. Because the function lives here (not in the persisted mutation),
// a mutation queued while offline can resume after an app restart.

import type { QueryClient } from '@tanstack/react-query';

import { markJobCompleted, markJobInProgress } from '../api/jobs';
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
