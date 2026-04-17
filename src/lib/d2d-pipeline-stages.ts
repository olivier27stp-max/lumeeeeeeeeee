/**
 * D2D Pipeline Stages — Single Source of Truth
 * =============================================
 * Used by: D2DPipeline.tsx, server sync engine, API routes.
 *
 * Stages are driven by real CRM events, not manual assignment:
 *   NEW_LEAD      → rep creates a quote from D2D
 *   MUST_RECALL   → pin marked revisit/follow-up/callback
 *   QUOTE_SENT    → quote status = "sent"
 *   CLOSED_WON    → job created from quote
 *   CLOSED_LOST   → quote declined / lead lost / manual X
 */

export const D2D_STAGES = ['new_lead', 'must_recall', 'quote_sent', 'closed_won', 'closed_lost'] as const;
export type D2DStage = typeof D2D_STAGES[number];

export const D2D_STAGE_CONFIG: Record<D2DStage, {
  label: string;
  labelFr: string;
  color: string;
  bgClass: string;
  /** DB value in pipeline_deals.stage column */
  dbValue: string;
  /** Can a card be manually dragged INTO this stage? */
  manualEntry: boolean;
  /** Reason shown if manual entry is blocked */
  blockReason?: string;
}> = {
  new_lead: {
    label: 'New Lead',
    labelFr: 'Nouveau Lead',
    color: '#58A6FF',
    bgClass: 'bg-blue-500/15 text-blue-400',
    dbValue: 'new',
    manualEntry: true,
  },
  must_recall: {
    label: 'Must Recall',
    labelFr: 'Rappel requis',
    color: '#D29922',
    bgClass: 'bg-amber-500/15 text-amber-400',
    dbValue: 'follow_up_1',
    manualEntry: true,
  },
  quote_sent: {
    label: 'Quote Sent',
    labelFr: 'Devis envoy\u00e9',
    color: '#9CA3AF',
    bgClass: 'bg-gray-500/15 text-gray-400',
    dbValue: 'follow_up_2',
    manualEntry: false,
    blockReason: 'Un devis doit \u00eatre envoy\u00e9 pour d\u00e9placer ici',
  },
  closed_won: {
    label: 'Closed Won',
    labelFr: 'Gagn\u00e9',
    color: '#3FB950',
    bgClass: 'bg-green-500/15 text-green-400',
    dbValue: 'closed',
    manualEntry: false,
    blockReason: 'Une job doit \u00eatre cr\u00e9\u00e9e depuis le devis',
  },
  closed_lost: {
    label: 'Closed Lost',
    labelFr: 'Perdu',
    color: '#F85149',
    bgClass: 'bg-red-500/15 text-red-400',
    dbValue: 'lost',
    manualEntry: true,
  },
};

/** Map DB stage value → D2D stage slug */
export const DB_TO_D2D_STAGE: Record<string, D2DStage> = {
  'new': 'new_lead',
  'follow_up_1': 'must_recall',
  'follow_up_2': 'quote_sent',
  'follow_up_3': 'quote_sent',
  'closed': 'closed_won',
  'lost': 'closed_lost',
};

/** Map D2D stage slug → DB stage value */
export const D2D_TO_DB_STAGE: Record<D2DStage, string> = {
  new_lead: 'new',
  must_recall: 'follow_up_1',
  quote_sent: 'follow_up_2',
  closed_won: 'closed',
  closed_lost: 'lost',
};

/** Secondary status layer — editable by reps, used for prioritization */
export const D2D_STATUSES = ['pending', 'follow_up', 'hot', 'cold', 'no_answer'] as const;
export type D2DStatus = typeof D2D_STATUSES[number];

export const D2D_STATUS_CONFIG: Record<D2DStatus, { label: string; labelFr: string; color: string }> = {
  pending:   { label: 'Pending',   labelFr: 'En attente', color: '#6B7280' },
  follow_up: { label: 'Follow-up', labelFr: 'Suivi',      color: '#06B6D4' },
  hot:       { label: 'Hot',       labelFr: 'Chaud',      color: '#EF4444' },
  cold:      { label: 'Cold',      labelFr: 'Froid',      color: '#3B82F6' },
  no_answer: { label: 'No Answer', labelFr: 'Pas de r\u00e9ponse', color: '#F59E0B' },
};
