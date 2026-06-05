// Stable mutation keys for offline-capable writes. A mutation registered with
// one of these keys uses the default mutationFn (see registerMutationDefaults),
// so React Query can PAUSE it while offline and resume it later — even across an
// app restart, because the persisted mutation only stores the key + variables,
// not the function.

export const MK = {
  jobStart: ['job', 'start'] as const,
  jobComplete: ['job', 'complete'] as const,
  punchIn: ['timesheet', 'punchIn'] as const,
  punchOut: ['timesheet', 'punchOut'] as const,
  startBreak: ['timesheet', 'startBreak'] as const,
  endBreak: ['timesheet', 'endBreak'] as const,
  d2dLogEvent: ['d2d', 'logEvent'] as const,
  d2dCreateHouse: ['d2d', 'createHouse'] as const,
};
